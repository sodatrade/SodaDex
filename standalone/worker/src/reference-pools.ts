import { ERC20_READ, FACTORY_READ, same, STATE_READ, V3_POOL_READ, ZERO } from './contracts'
import { hex, poolId, type Block } from './dex-data'
import { reference, V2_FACTORY, V2_PAIR, V3_FEES, V4_KEYS } from './reference-config'
import type { ReferencePool, ReferencePoolsResponse, ReferenceToken } from './reference-types'
import { call } from './upstream'
import { referenceToken } from './reference-tokens'

export function ratio(numerator: bigint, denominator: bigint): string | null {
  if (denominator <= 0n) return null
  const scale = 10n ** 320n, value = numerator * scale / denominator
  return `${value / scale}.${(value % scale).toString().padStart(320, '0')}`.replace(/\.?0+$/, '')
}
export function referencePrice(pool: ReferencePool): string | null {
  const d0 = pool.token0.decimals, d1 = pool.token1.decimals
  if (d0 === null || d1 === null) return null
  const scale0 = 10n ** BigInt(d0), scale1 = 10n ** BigInt(d1)
  if (pool.sqrtPriceX96 !== null && BigInt(pool.sqrtPriceX96) > 0n) return ratio(BigInt(pool.sqrtPriceX96) ** 2n * scale0, 2n ** 192n * scale1)
  if (pool.reserves.token0Raw !== null && pool.reserves.token1Raw !== null && BigInt(pool.reserves.token0Raw) > 0n) return ratio(BigInt(pool.reserves.token1Raw) * scale0, BigInt(pool.reserves.token0Raw) * scale1)
  return null
}
function sorted(tokens: ReferenceToken[]): [ReferenceToken, ReferenceToken] { return BigInt(tokens[0].address) < BigInt(tokens[1].address) ? [tokens[0], tokens[1]] : [tokens[1], tokens[0]] }
/** Returns null only when that exact factory pair/key does not exist or is uninitialized. */
export async function referencePool(protocol: 'v2' | 'v3' | 'v4', token0: ReferenceToken, token1: ReferenceToken, fee: number, spacing: number | null, block: Block, upstreamFetch: typeof fetch): Promise<ReferencePool | null> {
  const at = hex(block.number)
  let id: string, address: string | null = null
  let sqrtPriceX96: string | null = null, tick: number | null = null, liquidity: string | null = null, tickSpacing: number | null = spacing
  let stateError: string | null = null
  const reserves: ReferencePool['reserves'] = { token0Raw: null, token1Raw: null }
  if (protocol === 'v4') {
    id = poolId(token0.address, token1.address, fee, spacing!, ZERO)
    const slot = await call(STATE_READ, reference.contracts.v4StateView, 'getSlot0', [id], at, upstreamFetch)
    if (!Array.isArray(slot) || typeof slot[0] !== 'bigint' || typeof slot[1] !== 'number') throw new Error('Invalid V4 state')
    if (slot[0] === 0n) return null
    sqrtPriceX96 = String(slot[0]); tick = slot[1]
    const value = await call(STATE_READ, reference.contracts.v4StateView, 'getLiquidity', [id], at, upstreamFetch)
    if (typeof value !== 'bigint') throw new Error('Invalid V4 liquidity')
    liquidity = String(value)
  } else {
    const pool = await call(protocol === 'v2' ? V2_FACTORY : FACTORY_READ, protocol === 'v2' ? reference.contracts.v2Factory : reference.contracts.v3Factory, protocol === 'v2' ? 'getPair' : 'getPool', protocol === 'v2' ? [token0.address, token1.address] : [token0.address, token1.address, fee], at, upstreamFetch)
    if (typeof pool !== 'string') throw new Error('Invalid factory result')
    if (same(pool, ZERO)) return null
    address = pool; id = pool.toLowerCase()
    if (protocol === 'v2') {
      const [values, supply] = await Promise.all([call(V2_PAIR, pool, 'getReserves', [], at, upstreamFetch), call(V2_PAIR, pool, 'totalSupply', [], at, upstreamFetch)])
      if (!Array.isArray(values) || typeof values[0] !== 'bigint' || typeof values[1] !== 'bigint' || typeof supply !== 'bigint') throw new Error('Invalid V2 reserves')
      reserves.token0Raw = String(values[0]); reserves.token1Raw = String(values[1]); liquidity = String(supply)
    } else {
      const [slot, active, spacingValue] = await Promise.all([call(V3_POOL_READ, pool, 'slot0', [], at, upstreamFetch), call(V3_POOL_READ, pool, 'liquidity', [], at, upstreamFetch), call(V3_POOL_READ, pool, 'tickSpacing', [], at, upstreamFetch)])
      if (!Array.isArray(slot) || typeof slot[0] !== 'bigint' || typeof slot[1] !== 'number' || typeof active !== 'bigint' || typeof spacingValue !== 'number') throw new Error('Invalid V3 state')
      if (slot[0] === 0n) return null
      sqrtPriceX96 = String(slot[0]); tick = slot[1]; liquidity = String(active); tickSpacing = spacingValue
      const balances = await Promise.allSettled([token0, token1].map((token) => call(ERC20_READ, token.address, 'balanceOf', [pool], at, upstreamFetch)))
      if (balances.every((value) => value.status === 'fulfilled' && typeof value.value === 'bigint')) {
        reserves.token0Raw = String((balances[0] as PromiseFulfilledResult<bigint>).value)
        reserves.token1Raw = String((balances[1] as PromiseFulfilledResult<bigint>).value)
      } else stateError = 'Pool token balances unavailable'
    }
  }
  const result: ReferencePool = { protocol, source: 'uniswap', readOnly: true, id, address, token0, token1, fee, tickSpacing, hooks: protocol === 'v4' ? ZERO : null, sqrtPriceX96, tick, liquidity, reserves, priceToken1PerToken0: null, stateError }
  result.priceToken1PerToken0 = referencePrice(result)
  return result
}
export async function referencePools(requested0: string, requested1: string, block: Block, upstreamFetch: typeof fetch): Promise<ReferencePoolsResponse> {
  const nativeTokens = await Promise.all([referenceToken(requested0, block, upstreamFetch), referenceToken(requested1, block, upstreamFetch)])
  const wrapped = nativeTokens.find((token) => same(token.address, ZERO)) ? await referenceToken(reference.wrappedNative, block, upstreamFetch) : null
  const actual = nativeTokens.map((token) => same(token.address, ZERO) ? wrapped! : token)
  const v23 = sorted(actual), v4 = sorted(nativeTokens)
  const candidates: { protocol: 'v2' | 'v3' | 'v4'; fee: number; tickSpacing: number | null; tokens: [ReferenceToken, ReferenceToken] }[] = [
    ...(same(actual[0].address, actual[1].address) ? [] : [{ protocol: 'v2' as const, fee: 3000, tickSpacing: null, tokens: v23 }, ...V3_FEES.map((fee) => ({ protocol: 'v3' as const, fee, tickSpacing: null, tokens: v23 }))]),
    ...V4_KEYS.map((key) => ({ protocol: 'v4' as const, ...key, tokens: v4 })),
  ]
  const results = await Promise.allSettled(candidates.map((candidate) => referencePool(candidate.protocol, ...candidate.tokens, candidate.fee, candidate.tickSpacing, block, upstreamFetch)))
  return { schemaVersion: 1, chainId: 196, source: 'uniswap', readOnly: true, asOf: block, requestedPair: { token0: requested0, token1: requested1 },
    pools: results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []),
    discovery: { kind: 'pair-candidates', complete: false, v3Fees: V3_FEES, v4Keys: V4_KEYS },
    errors: results.flatMap((result, index) => result.status === 'rejected' ? [{ protocol: candidates[index].protocol, fee: candidates[index].fee, tickSpacing: candidates[index].tickSpacing, message: 'Pool data temporarily unavailable' }] : []) }
}
