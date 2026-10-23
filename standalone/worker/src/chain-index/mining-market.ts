import { MINING_MARKET_INTERVALS, miningCandles, miningTradePrice, type MiningMarketInterval, type MiningMarketTrade } from '../../../mining-market'
import { BadRequest } from '../dex-data'
import { IndexRestart } from './api'
import type { IndexStore } from './store'
import type { IndexedEvent, IndexConfig, SqlValue } from './types'

function amount(event: IndexedEvent, key: string): bigint {
  const value = event.args[key]
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw Error('Invalid indexed amount')
  return BigInt(value)
}
export function miningMarketTrade(event: IndexedEvent, token: string, fab: string): MiningMarketTrade {
  let asset: bigint, quote: bigint, buy: boolean, source: MiningMarketTrade['source']
  if (event.event === 'Trade') {
    source = 'curve'; buy = event.args.isBuy === true
    asset = amount(event, 'tokenAmount'); quote = amount(event, 'curveQuoteAmount')
  } else if (event.event === 'Swapped') {
    source = 'fragments'; buy = event.args.shareIn === false
    asset = amount(event, buy ? 'output' : 'input'); quote = amount(event, buy ? 'input' : 'output')
  } else {
    source = 'pair'
    const asset0 = BigInt(token) < BigInt(fab), side = asset0 ? '0' : '1', other = asset0 ? '1' : '0'
    const input = amount(event, `amount${side}In`), output = amount(event, `amount${side}Out`)
    buy = output > 0n
    if (input > 0n && output > 0n) throw Error('Ambiguous swap')
    asset = buy ? output : input; quote = amount(event, `amount${other}${buy ? 'In' : 'Out'}`)
  }
  return { id: event.id, transactionHash: event.transactionHash, timestamp: event.timestamp, blockNumber: event.blockNumber,
    source, buy, assetRaw: String(asset), fabRaw: String(quote), price: miningTradePrice(asset, quote) }
}
/** A bounded SQL snapshot. No RPC scan, and history pages remain pinned to their first checkpoint. */
export function miningMarket(url: URL, store: IndexStore, config: IndexConfig): object {
  if (config.profile.dexEnabled) throw new BadRequest('Mining profile required')
  const params = [...url.searchParams.keys()]
  if (params.some(k => !['token', 'interval', 'cursor'].includes(k)) || new Set(params).size !== params.length) throw new BadRequest('Invalid market query')
  const token = url.searchParams.get('token')?.toLowerCase(), interval = url.searchParams.get('interval') ?? '5m'
  if (!token || !/^0x[\da-f]{40}$/.test(token) || !Object.hasOwn(MINING_MARKET_INTERVALS, interval)) throw new BadRequest('Invalid market selection')
  const query = JSON.stringify(['mining-market', token, interval]), cursor = url.searchParams.get('cursor')
  const state = store.status(), saved = cursor ? store.cursor(cursor) : null
  if (cursor && (!saved || saved.query !== query || saved.generation !== state.generation)) throw new IndexRestart('Index changed; refresh market')
  const through = saved?.through ?? state.indexedThrough, asOf = saved?.asOf ?? store.anchor(), offset = saved?.offset ?? 0
  const address = (role: string): string => { const value = config.sources.find(s => s.role === role)?.address; if (!value) throw Error('Missing source'); return value }
  const fab = address('fab'), fragments = token === address('fragmentVault')
  let where: string, bindings: SqlValue[]
  if (fragments) { where = "event='Swapped' AND address=?"; bindings = [address('fragmentPool')] }
  else {
    const created = store.query("SELECT args FROM index_events WHERE event='TokenCreated' AND address=? AND lower(json_extract(args,'$.token'))=? AND block_number<=? LIMIT 1", address('manager'), token, through)[0]
    if (!created) throw new BadRequest('Project not indexed yet')
    const metadata = JSON.parse(String(created.args)) as { quote: string }
    if (metadata.quote.toLowerCase() !== fab) throw new BadRequest('Unsupported quote asset')
    const graduation = store.query("SELECT args FROM index_events WHERE event='GraduatedV2' AND address=? AND lower(json_extract(args,'$.token'))=? AND block_number<=? ORDER BY block_number DESC,log_index DESC LIMIT 1", address('manager'), token, through)[0]
    const pair = graduation ? (JSON.parse(String(graduation.args)) as { pair: string }).pair.toLowerCase() : ''
    where = "((event='Trade' AND address=? AND lower(json_extract(args,'$.token'))=?) OR (event='Swap' AND address=?))"
    bindings = [address('manager'), token, pair]
  }
  const rows = store.query(`SELECT value FROM index_events WHERE ${where} AND block_number<=? ORDER BY block_number DESC,log_index DESC LIMIT 5001`, ...bindings, through)
  const limited = rows.length > 5000
  const trades = rows.slice(0, 5000).map(row => miningMarketTrade(JSON.parse(String(row.value)) as IndexedEvent, token, fab))
  const total = Number(store.query(`SELECT count(*) AS count FROM index_events WHERE ${where} AND block_number<=?`, ...bindings, through)[0].count)
  const page = store.query(`SELECT value FROM index_events WHERE ${where} AND block_number<=? ORDER BY block_number DESC,log_index DESC LIMIT 10 OFFSET ?`, ...bindings, through, offset).map(row => miningMarketTrade(JSON.parse(String(row.value)) as IndexedEvent, token, fab))
  const next = offset + 10 < total ? store.saveCursor({ query, generation: state.generation, through, asOf, offset: offset + 10, expires: Date.now() + 3_600_000 }) : null
  // oxlint-disable-next-line unicorn/no-array-reverse -- Reverse a copy for chronological OHLC; preserve descending history order on ES2022.
  const chronological = [...trades].reverse()
  return { schemaVersion: 1, chainId: config.profile.chainId, deploymentVersion: config.version, token, interval, asOf, index: state,
    candles: miningCandles(chronological, interval as MiningMarketInterval), trades: page, nextCursor: next, total, historyLimited: limited }
}
