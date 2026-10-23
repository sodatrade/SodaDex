import { deployment, ERC20_READ, record, same, ZERO } from './contracts'
import { type Block, type ChainLog, decodeLog, hex, logs, type Pool } from './dex-data'
import { blockAt, RestartScan } from './cursors'
import { call, RpcUnavailable } from './upstream'
import type { Hex } from 'viem'
import { chartPrice } from './dex-chart-math'
import type { ChartToken, ChartTrade } from './dex-chart-types'
import { decodeV2, reserveSqrt } from './v2-data'

export async function chartToken(address: string, asOf: Block, upstreamFetch: typeof fetch): Promise<ChartToken> {
  if (same(address, ZERO)) return { address, symbol: 'OKB', name: 'OKB', decimals: 18 }
  const read = async (name: string): Promise<unknown> => {
    try { return await call(ERC20_READ, address, name, [], hex(asOf.number), upstreamFetch) } catch { return null }
  }
  const [symbol, name, decimals] = await Promise.all([read('symbol'), read('name'), read('decimals')])
  return { address, symbol: typeof symbol === 'string' ? symbol.slice(0, 80) : null, name: typeof name === 'string' ? name.slice(0, 160) : null, decimals: typeof decimals === 'number' && decimals >= 0 && decimals <= 255 ? decimals : null }
}
export async function verifiedChartBlock(number: number, source: ChainLog[], asOf: Block, restartFromBlock: number, upstreamFetch: typeof fetch): Promise<Block> {
  const header = await blockAt(number, upstreamFetch)
  if (!Number.isSafeInteger(header.timestamp) || header.timestamp < 0 || header.timestamp > asOf.timestamp) throw new RpcUnavailable('Invalid chart block timestamp')
  if (source.some((log) => Number(BigInt(log.blockNumber)) !== number || !same(log.blockHash, header.hash))) throw new RestartScan('CHAIN_REORGANIZED', restartFromBlock)
  return header
}
export function chartTrade(log: ChainLog, header: Block, pool: Pool, token0: ChartToken, token1: ChartToken, preceding?: ChainLog): ChartTrade {
  if (pool.protocol === 'v2') {
    const swap = decodeV2(log), sync = preceding && decodeV2(preceding)
    if (swap.eventName !== 'Swap' || !sync || sync.eventName !== 'Sync' || !preceding ||
      !same(log.address, pool.id) || !same(log.address, preceding.address) || !same(log.transactionHash, preceding.transactionHash) ||
      !same(log.blockHash, preceding.blockHash) || BigInt(preceding.logIndex) + 1n !== BigInt(log.logIndex))
      throw new RpcUnavailable('V2 swap reserve event unavailable')
    const p = swap.args, sqrt = reserveSqrt(BigInt(String(sync.args.reserve0)), BigInt(String(sync.args.reserve1)))
    if (sqrt === '0') throw new RpcUnavailable('Invalid V2 swap reserves')
    const in0 = BigInt(String(p.amount0In)), in1 = BigInt(String(p.amount1In)), out0 = BigInt(String(p.amount0Out)), out1 = BigInt(String(p.amount1Out))
    const logIndex = Number(BigInt(log.logIndex))
    return { id: `${header.hash.toLowerCase()}:${logIndex}`, blockNumber: header.number, blockHash: header.hash.toLowerCase(),
      transactionHash: log.transactionHash.toLowerCase(), logIndex, timestamp: header.timestamp,
      amount0Raw: String(in0 - out0), amount1Raw: String(in1 - out1), volume0Raw: String(in0 + out0), volume1Raw: String(in1 + out1),
      sqrtPriceX96: sqrt, priceToken1PerToken0: chartPrice(sqrt, token0.decimals, token1.decimals), sender: String(p.sender), recipient: String(p.to),
      priceSource: 'v2-reserves' }
  }
  const decoded = decodeLog(log)
  const p = decoded.args
  if (decoded.eventName !== 'Swap' || typeof p.amount0 !== 'bigint' || typeof p.amount1 !== 'bigint' || typeof p.sqrtPriceX96 !== 'bigint' || p.sqrtPriceX96 <= 0n || typeof p.sender !== 'string' || (pool.protocol === 'v3' && typeof p.recipient !== 'string') || (pool.protocol === 'v4' && (typeof p.id !== 'string' || !same(p.id, pool.id))) || (pool.protocol === 'v4' && !same(log.address, deployment.contracts.v4PoolManager))) throw new RpcUnavailable('Invalid chart swap event')
  const logIndex = Number(BigInt(log.logIndex))
  if (!Number.isSafeInteger(logIndex)) throw new RpcUnavailable('Invalid chart log index')
  return { id: `${header.hash.toLowerCase()}:${logIndex}`, blockNumber: header.number, blockHash: header.hash.toLowerCase(), transactionHash: log.transactionHash.toLowerCase(), logIndex, timestamp: header.timestamp, amount0Raw: String(p.amount0), amount1Raw: String(p.amount1), volume0Raw: String(p.amount0 < 0n ? -p.amount0 : p.amount0), volume1Raw: String(p.amount1 < 0n ? -p.amount1 : p.amount1), sqrtPriceX96: String(p.sqrtPriceX96), priceToken1PerToken0: chartPrice(String(p.sqrtPriceX96), token0.decimals, token1.decimals), sender: p.sender, recipient: typeof p.recipient === 'string' ? p.recipient : null }
}

/** Reuse the shared log validator while rejecting contradictory duplicate identities before its deduplication. */
export async function chartLogs(pool: Pool, fromBlock: number, toBlock: number, topics: (Hex | Hex[] | null)[], upstreamFetch: typeof fetch): Promise<ChainLog[]> {
  const checkedFetch: typeof fetch = async (input, options) => {
    const response = await upstreamFetch(input, options)
    if (response.ok) {
      const body: unknown = await response.clone().json()
      if (record(body) && Array.isArray(body.result)) {
        const identities = new Map<string, string>()
        for (const item of body.result) {
          if (!record(item) || item.removed || typeof item.blockHash !== 'string' || typeof item.logIndex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(item.logIndex)) continue
          const id = `${item.blockHash.toLowerCase()}:${BigInt(item.logIndex)}`
          const canonical = JSON.stringify([item.address, item.blockNumber, item.transactionHash, item.topics, item.data]).toLowerCase()
          const previous = identities.get(id)
          if (previous !== undefined && previous !== canonical) throw new RpcUnavailable('Conflicting chart log identity')
          identities.set(id, canonical)
        }
      }
    }
    return response
  }
  return logs([pool.address ?? deployment.contracts.v4PoolManager], fromBlock, toBlock, topics, checkedFetch)
}
