import { V2_PAIR_EVENTS } from '../../v2-protocol'
import { toEventSelector, type Hex } from 'viem'
import { EVENTS, FIRST_BLOCK, PAGE_BLOCKS } from './contracts'
import { BadRequest, type Block, type ChainLog, type Pool, integer, snapshot } from './dex-data'
import { blockAt, loadCursor, queryKey, verifyAnchor, type CursorStore, type ScanCursor } from './cursors'
import { resolvePool } from './dex-market'
import { RpcUnavailable } from './upstream'
import { chartCandles, chartPrice } from './dex-chart-math'
import { chartLogs, chartToken, chartTrade, verifiedChartBlock } from './dex-chart-source'
import { CHART_INTERVALS, type ChartInterval, type ChartResponse, type ChartToken, type ChartTrade } from './dex-chart-types'

const BLOCK_HEADERS_PER_REQUEST = 8
const MAX_CHART_TRADES = 5000 // Bound ephemeral Worker/cache memory; dense queries must request a smaller range.
export class ChartRangeTooLarge extends BadRequest {}
interface ChartCursor extends ScanCursor {
  kind: 'chart'; interval: ChartInterval; fromBlock: number; targetBlock: number; throughBlock: number; nextBlock: number
  pageToBlock: number | null; pending: ChainLog[]; pool: Pool; token0: ChartToken; token1: ChartToken; trades: ChartTrade[]
}
function interval(url: URL): ChartInterval {
  const value = url.searchParams.get('interval')
  if (value === null || !Object.hasOwn(CHART_INTERVALS, value)) throw new BadRequest('Chart interval must be 1m, 5m, 1h, 4h or 1d')
  return value as ChartInterval
}
async function initial(url: URL, asOf: Block, upstreamFetch: typeof fetch): Promise<ChartCursor> {
  const selectedInterval = interval(url)
  const fromBlock = integer(url.searchParams.get('fromBlock'), FIRST_BLOCK)
  const targetBlock = Math.min(integer(url.searchParams.get('toBlock'), asOf.number), asOf.number)
  if (fromBlock < FIRST_BLOCK || fromBlock > targetBlock) throw new BadRequest('Invalid block range')
  const base = await resolvePool(url, asOf, upstreamFetch)
  const protocol = url.searchParams.get('protocol')
  if (protocol !== null && protocol !== base.protocol) throw new BadRequest('Pool protocol mismatch')
  const [pool, token0, token1] = await Promise.all([snapshot(base, asOf, upstreamFetch), chartToken(base.token0, asOf, upstreamFetch), chartToken(base.token1, asOf, upstreamFetch)])
  if (pool.sqrtPriceX96 === '0') throw new BadRequest('Pool is not initialized')
  if (pool.stateError || pool.sqrtPriceX96 === null) throw new RpcUnavailable('Chart pool state unavailable')
  const anchor = targetBlock === asOf.number ? asOf : await blockAt(targetBlock, upstreamFetch)
  return { kind: 'chart', query: queryKey(url), asOf, anchor, range: { fromBlock, toBlock: targetBlock, complete: false, nextFromBlock: fromBlock }, interval: selectedInterval, fromBlock, targetBlock, throughBlock: fromBlock - 1, nextBlock: fromBlock, pageToBlock: null, pending: [], pool, token0, token1, trades: [] }
}
async function readPage(state: ChartCursor, upstreamFetch: typeof fetch): Promise<void> {
  if (state.pageToBlock !== null || state.nextBlock > state.targetBlock) return
  state.pageToBlock = Math.min(state.targetBlock, state.nextBlock + PAGE_BLOCKS - 1)
  const topics: (Hex | Hex[] | null)[] = state.pool.protocol === 'v2' ? [[toEventSelector(V2_PAIR_EVENTS[2]), toEventSelector(V2_PAIR_EVENTS[3])]] : state.pool.protocol === 'v3' ? [toEventSelector(EVENTS[2])] : [toEventSelector(EVENTS[3]), state.pool.id as Hex]
  state.pending = await chartLogs(state.pool, state.nextBlock, state.pageToBlock, topics, upstreamFetch)
}
async function processPage(state: ChartCursor, upstreamFetch: typeof fetch): Promise<void> {
  const blocks = [...new Set(state.pending.map((log) => Number(BigInt(log.blockNumber))))].slice(0, BLOCK_HEADERS_PER_REQUEST)
  const headers = await Promise.all(blocks.map((number) => verifiedChartBlock(number, state.pending.filter((log) => Number(BigInt(log.blockNumber)) === number), state.asOf, state.fromBlock, upstreamFetch)))
  const byNumber = new Map(headers.map((header) => [header.number, header]))
  const ids = new Map(state.trades.map((trade) => [trade.id, trade]))
  for (const [index, log] of state.pending.entries()) {
    if (state.pool.protocol === 'v2' && log.topics[0].toLowerCase() !== toEventSelector(V2_PAIR_EVENTS[2])) continue
    const header = byNumber.get(Number(BigInt(log.blockNumber)))
    if (!header) continue
    const trade = chartTrade(log, header, state.pool, state.token0, state.token1, state.pending[index - 1])
    const previous = state.trades.at(-1)
    if (previous && trade.timestamp < previous.timestamp) throw new RpcUnavailable('Nonmonotonic chart block timestamps')
    const duplicate = ids.get(trade.id)
    if (duplicate) {
      if (JSON.stringify(duplicate) !== JSON.stringify(trade)) throw new RpcUnavailable('Conflicting chart log identity')
      continue
    }
    state.trades.push(trade)
    ids.set(trade.id, trade)
  }
  if (state.trades.length > MAX_CHART_TRADES) throw new ChartRangeTooLarge('Chart range exceeds 5000 trades; choose a narrower block range')
  state.pending = state.pending.filter((log) => !byNumber.has(Number(BigInt(log.blockNumber))))
  if (state.pending.length) state.throughBlock = Number(BigInt(state.pending[0].blockNumber)) - 1
  else {
    state.throughBlock = state.pageToBlock!
    state.nextBlock = state.throughBlock + 1
    state.pageToBlock = null
  }
}
export interface IndexedChartSource { asOf: Block; rows: { log: ChainLog; block: Block }[] }
export type ChartSourceReader = (url: URL) => Promise<IndexedChartSource>
export async function indexedChart(url: URL, upstreamFetch: typeof fetch, read: ChartSourceReader): Promise<ChartResponse> {
  interval(url)
  const source = await read(url)
  const state = await initial(url, source.asOf, upstreamFetch)
  if (source.rows.length > MAX_CHART_TRADES * 2) throw new ChartRangeTooLarge('Chart range exceeds 5000 trades; choose a narrower block range')
  state.trades = source.rows.flatMap(({ log, block }, index) => state.pool.protocol === 'v2' && log.topics[0].toLowerCase() !== toEventSelector(V2_PAIR_EVENTS[2]) ? [] : [chartTrade(log, block, state.pool, state.token0, state.token1, source.rows[index - 1]?.log)])
  if (state.trades.length > MAX_CHART_TRADES) throw new ChartRangeTooLarge('Chart range exceeds 5000 trades; choose a narrower block range')
  await verifyAnchor(state, upstreamFetch)
  const price = chartPrice(state.pool.sqrtPriceX96!, state.token0.decimals, state.token1.decimals)
  return { schemaVersion: 1, chainId: 196, asOf: state.asOf, coverage: { fromBlock: state.fromBlock, toBlock: state.targetBlock, complete: state.fromBlock === FIRST_BLOCK && state.targetBlock === state.asOf.number, nextFromBlock: null }, pool: state.pool, token0: state.token0, token1: state.token1, interval: state.interval, query: { fromBlock: state.fromBlock, toBlock: state.targetBlock }, priceToken1PerToken0: price, priceUnavailableReason: price === null ? 'Token decimals unavailable' : null, candles: chartCandles(state.trades, state.interval), trades: state.trades, queryComplete: true, nextCursor: null }
}
export async function chart(url: URL, current: Block, upstreamFetch: typeof fetch, store: CursorStore): Promise<ChartResponse> {
  // Validate interval even on continuations; the stored query also prevents parameter substitution.
  interval(url)
  const saved = await loadCursor<ChartCursor>(url, 'chart', store, integer(url.searchParams.get('fromBlock'), FIRST_BLOCK))
  if (saved) await verifyAnchor(saved, upstreamFetch)
  const state = saved ?? await initial(url, current, upstreamFetch)
  try {
    await readPage(state, upstreamFetch)
    await processPage(state, upstreamFetch)
  } catch (error) {
    await verifyAnchor(state, upstreamFetch)
    throw error
  }
  await verifyAnchor(state, upstreamFetch)
  const queryComplete = state.nextBlock > state.targetBlock && state.pending.length === 0
  const price = chartPrice(state.pool.sqrtPriceX96!, state.token0.decimals, state.token1.decimals)
  return { schemaVersion: 1, chainId: 196, asOf: state.asOf, coverage: { fromBlock: state.fromBlock, toBlock: state.throughBlock, complete: queryComplete && state.fromBlock === FIRST_BLOCK && state.targetBlock === state.asOf.number, nextFromBlock: queryComplete ? null : state.throughBlock + 1 }, pool: state.pool, token0: state.token0, token1: state.token1, interval: state.interval, query: { fromBlock: state.fromBlock, toBlock: state.targetBlock }, priceToken1PerToken0: price, priceUnavailableReason: price === null ? 'Token decimals unavailable; raw sqrt prices and volumes remain exact' : null, candles: chartCandles(state.trades, state.interval), trades: state.trades, queryComplete, nextCursor: queryComplete ? null : await store.put(state) }
}
