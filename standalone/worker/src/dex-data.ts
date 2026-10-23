import { V2, V2_FACTORY } from '../../v2-protocol'
import { v2Created, v2Snapshot } from './v2-data'
import { decodeEventLog, encodeAbiParameters, keccak256, parseAbiParameters, toEventSelector, type Hex } from 'viem'
import { deployment, EVENTS, FIRST_BLOCK, PAGE_BLOCKS, pools, record, same, STATE_READ, V3_POOL_READ, ZERO } from './contracts'
import { call, rpc, RpcUnavailable } from './upstream'

export interface Block { number: number; hash: string; timestamp: number }
export interface Coverage { fromBlock: number; toBlock: number; complete: boolean; nextFromBlock: number | null }
export interface Pool {
  protocol: 'v2' | 'v3' | 'v4'; id: string; address: string | null; token0: string; token1: string; fee: number; tickSpacing: number; hooks: string
  createdBlock: number | null; source: 'manifest' | 'chain'; sqrtPriceX96: string | null; tick: number | null; liquidity: string | null; stateError: string | null
}
export interface ChainLog { address: string; topics: [Hex, ...Hex[]]; data: Hex; blockNumber: Hex; blockHash: Hex; transactionHash: Hex; logIndex: Hex; removed?: boolean }
export class BadRequest extends Error {}
export const hex = (value: number): Hex => `0x${value.toString(16)}`
export function integer(value: string | null, fallback: number): number {
  if (value === null) return fallback
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new BadRequest('Invalid block range')
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new BadRequest('Invalid block range')
  return result
}
export async function head(upstreamFetch: typeof fetch): Promise<Block> {
  const value = await rpc('eth_getBlockByNumber', ['latest', false], upstreamFetch)
  if (!record(value) || typeof value.number !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value.number) || typeof value.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value.hash) || typeof value.timestamp !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value.timestamp)) throw new RpcUnavailable('Invalid block response')
  const number = Number(BigInt(value.number)), timestamp = Number(BigInt(value.timestamp))
  if (!Number.isSafeInteger(number) || !Number.isSafeInteger(timestamp)) throw new RpcUnavailable('Invalid block response')
  return { number, hash: value.hash, timestamp }
}
export function coverage(url: URL, block: Block, recent = false): Coverage {
  const from = integer(url.searchParams.get('fromBlock'), recent ? Math.max(FIRST_BLOCK, block.number - PAGE_BLOCKS + 1) : FIRST_BLOCK)
  const target = Math.min(integer(url.searchParams.get('toBlock'), block.number), block.number)
  if (from < FIRST_BLOCK || from > target) throw new BadRequest('Invalid block range')
  const to = Math.min(target, from + PAGE_BLOCKS - 1)
  return { fromBlock: from, toBlock: to, complete: from === FIRST_BLOCK && to === block.number, nextFromBlock: to < target ? to + 1 : null }
}
export async function logs(addresses: string[], from: number, to: number, topics: (Hex | Hex[] | null)[], upstreamFetch: typeof fetch): Promise<ChainLog[]> {
  const value = await rpc('eth_getLogs', [{ address: addresses.length === 1 ? addresses[0] : addresses, fromBlock: hex(from), toBlock: hex(to), topics }], upstreamFetch)
  if (!Array.isArray(value) || value.length > 1000) throw new RpcUnavailable('Log page unavailable; request a narrower block interval')
  const valid = value.filter((item): item is ChainLog => record(item) && typeof item.address === 'string' && Array.isArray(item.topics) && item.topics.every((topic) => typeof topic === 'string' && /^0x[0-9a-fA-F]{64}$/.test(topic)) && typeof item.data === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(item.data) && ['blockNumber', 'logIndex'].every((key) => typeof item[key] === 'string' && /^0x[0-9a-fA-F]+$/.test(item[key] as string)) && ['blockHash', 'transactionHash'].every((key) => typeof item[key] === 'string' && /^0x[0-9a-fA-F]{64}$/.test(item[key] as string)) && !item.removed)
  if (valid.length !== value.filter((item) => !record(item) || !item.removed).length) throw new RpcUnavailable('Invalid log response')
  // Do not trust an upstream to honor the address/range filter.
  const matchesTopics = (item: ChainLog): boolean => topics.every((filter, index) => filter === null || (Array.isArray(filter) ? filter.some((topic) => same(topic, item.topics[index] ?? '')) : same(filter, item.topics[index] ?? '')))
  if (valid.some((item) => !matchesTopics(item) || !addresses.some((address) => same(item.address, address)) || Number(BigInt(item.blockNumber)) < from || Number(BigInt(item.blockNumber)) > to)) throw new RpcUnavailable('Mismatched log response')
  // oxlint-disable-next-line unicorn/no-array-sort -- The ES2022 target lacks toSorted; this sorts a fresh copy.
  return [...new Map(valid.map((item) => [`${item.blockHash}:${item.logIndex}`, item])).values()].sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)))
}
export function decodeLog(log: ChainLog): { eventName: string; args: Record<string, unknown> } {
  const decoded = decodeEventLog({ abi: EVENTS, topics: log.topics, data: log.data, strict: true })
  return { eventName: decoded.eventName, args: decoded.args as unknown as Record<string, unknown> }
}
const empty = { sqrtPriceX96: null, tick: null, liquidity: null, stateError: null }
export function knownPools(): Pool[] {
  return [
    { protocol: 'v3', id: pools.v3.address.toLowerCase(), address: pools.v3.address, token0: pools.v3.token0, token1: pools.v3.token1, fee: pools.v3.fee, tickSpacing: pools.v3.tickSpacing, hooks: ZERO, createdBlock: null, source: 'manifest', ...empty },
    { protocol: 'v4', id: pools.v4.poolId, address: null, token0: pools.v4.currency0, token1: pools.v4.currency1, fee: pools.v4.fee, tickSpacing: pools.v4.tickSpacing, hooks: pools.v4.hooks, createdBlock: null, source: 'manifest', ...empty },
  ]
}
export async function discover(range: Coverage, upstreamFetch: typeof fetch): Promise<Pool[]> {
  const results = await Promise.all([
    logs([V2.factory], range.fromBlock, range.toBlock, [toEventSelector(V2_FACTORY[4])], upstreamFetch),
    logs([deployment.contracts.v3Factory], range.fromBlock, range.toBlock, [toEventSelector(EVENTS[0])], upstreamFetch),
    logs([deployment.contracts.v4PoolManager], range.fromBlock, range.toBlock, [toEventSelector(EVENTS[1])], upstreamFetch),
  ])
  return results.flat().map((log) => {
    if (same(log.address, V2.factory)) return v2Created(log)
    const { eventName, args } = decodeLog(log)
    const v3 = eventName === 'PoolCreated'
    return { protocol: v3 ? 'v3' : 'v4', id: String(v3 ? args.pool : args.id).toLowerCase(), address: v3 ? String(args.pool) : null, token0: String(v3 ? args.token0 : args.currency0), token1: String(v3 ? args.token1 : args.currency1), fee: Number(args.fee), tickSpacing: Number(args.tickSpacing), hooks: v3 ? ZERO : String(args.hooks), createdBlock: Number(BigInt(log.blockNumber)), source: 'chain', ...empty } as Pool
  })
}
export async function snapshot(pool: Pool, block: Block, upstreamFetch: typeof fetch): Promise<Pool> {
  try {
    if (pool.protocol === 'v2') return await v2Snapshot(pool, block, upstreamFetch)
    const at = hex(block.number)
    const [slot, liquidity] = await Promise.all(pool.protocol === 'v3' ? [call(V3_POOL_READ, pool.address!, 'slot0', [], at, upstreamFetch), call(V3_POOL_READ, pool.address!, 'liquidity', [], at, upstreamFetch)] : [call(STATE_READ, deployment.contracts.v4StateView, 'getSlot0', [pool.id], at, upstreamFetch), call(STATE_READ, deployment.contracts.v4StateView, 'getLiquidity', [pool.id], at, upstreamFetch)])
    if (!Array.isArray(slot) || typeof slot[0] !== 'bigint' || typeof slot[1] !== 'number' || typeof liquidity !== 'bigint') throw new Error('Invalid pool state')
    return { ...pool, sqrtPriceX96: String(slot[0]), tick: slot[1], liquidity: String(liquidity), stateError: slot[0] === 0n ? 'Pool is not initialized' : null }
  } catch { return { ...pool, stateError: 'Pool state temporarily unavailable' } }
}
export function poolId(token0: string, token1: string, fee: number, tickSpacing: number, hooks: string): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'), [token0 as Hex, token1 as Hex, fee, tickSpacing, hooks as Hex]))
}
