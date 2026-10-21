import { decodeEventLog, type Hex } from 'viem'
import { V2, V2_FACTORY, V2_PAIR, V2_PAIR_EVENTS } from '../../v2-protocol'
import { same, ZERO } from './contracts'
import type { Block, ChainLog, Pool } from './dex-data'
import { call, RpcUnavailable } from './upstream'

export function v2Created(log: ChainLog): Pool {
  const { args } = decodeEventLog({ abi: V2_FACTORY, eventName: 'PairCreated', data: log.data, topics: log.topics })
  return { protocol: 'v2', id: args.pair.toLowerCase(), address: args.pair, token0: args.token0, token1: args.token1,
    fee: 3000, tickSpacing: 0, hooks: ZERO, createdBlock: Number(BigInt(log.blockNumber)), source: 'chain',
    sqrtPriceX96: null, tick: null, liquidity: null, stateError: null }
}
/** Derived chart coordinate only: V2 prices come from reserve1/reserve0, never a V3 slot/event. */
export function reserveSqrt(reserve0: bigint, reserve1: bigint): string {
  if (reserve0 <= 0n || reserve1 <= 0n) return '0'
  const ratio = (reserve1 << 192n) / reserve0
  if (ratio < 2n) return String(ratio)
  let x = ratio, y = (x + 1n) / 2n
  while (y < x) { x = y; y = (x + ratio / x) / 2n }
  return String(x)
}
export async function v2Reserves(pool: Pool, block: Block, upstream: typeof fetch): Promise<readonly [bigint, bigint]> {
  const reserves = await call(V2_PAIR, pool.address!, 'getReserves', [], `0x${block.number.toString(16)}`, upstream)
  if (!Array.isArray(reserves) || typeof reserves[0] !== 'bigint' || typeof reserves[1] !== 'bigint') throw new RpcUnavailable('Invalid V2 reserves')
  return [reserves[0], reserves[1]]
}
export async function v2Snapshot(pool: Pool, block: Block, upstream: typeof fetch): Promise<Pool> {
  const reserves = await v2Reserves(pool, block, upstream)
  return { ...pool, sqrtPriceX96: reserveSqrt(reserves[0], reserves[1]), tick: null, liquidity: null,
    stateError: reserves[0] <= 0n || reserves[1] <= 0n ? 'Pool is not initialized' : null }
}
export function decodeV2(log: ChainLog): { eventName: string; args: Record<string, unknown> } {
  const d = decodeEventLog({ abi: V2_PAIR_EVENTS, data: log.data, topics: log.topics, strict: true })
  return { eventName: d.eventName, args: d.args as unknown as Record<string, unknown> }
}
export async function resolveV2(id: Hex, block: Block, upstream: typeof fetch): Promise<Pool> {
  const at = `0x${block.number.toString(16)}`
  const [factory, token0, token1] = await Promise.all(['factory', 'token0', 'token1'].map(name => call(V2_PAIR, id, name, [], at, upstream)))
  if (typeof factory !== 'string' || !same(factory, V2.factory) || typeof token0 !== 'string' || typeof token1 !== 'string') throw new RpcUnavailable('Foreign V2 pool')
  const registered = await call(V2_FACTORY, V2.factory, 'getPair', [token0, token1], at, upstream)
  if (typeof registered !== 'string' || !same(registered, id)) throw new RpcUnavailable('Foreign V2 pool')
  return { protocol: 'v2', id: id.toLowerCase(), address: id, token0, token1, fee: 3000, tickSpacing: 0, hooks: ZERO,
    createdBlock: null, source: 'chain', sqrtPriceX96: null, tick: null, liquidity: null, stateError: null }
}
