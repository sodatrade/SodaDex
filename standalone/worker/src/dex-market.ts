import { toEventSelector } from 'viem'
import { deployment, ERC20_READ, EVENTS, FACTORY_READ, same, V3_POOL_READ, ZERO } from './contracts'
import { BadRequest, type Block, type Coverage, type Pool, decodeLog, hex, knownPools, logs, poolId, snapshot } from './dex-data'
import { call } from './upstream'
interface Token { address: string; symbol: string | null; name: string | null; decimals: number | null }
async function token(address: string, block: Block, upstreamFetch: typeof fetch): Promise<Token> {
  if (same(address, ZERO)) return { address, symbol: 'OKB', name: 'OKB', decimals: 18 }
  const read = async (name: string): Promise<unknown> => { try { return await call(ERC20_READ, address, name, [], hex(block.number), upstreamFetch) } catch { return null } }
  const [symbol, name, decimals] = await Promise.all([read('symbol'), read('name'), read('decimals')])
  return { address, symbol: typeof symbol === 'string' ? symbol.slice(0, 80) : null, name: typeof name === 'string' ? name.slice(0, 160) : null, decimals: typeof decimals === 'number' ? decimals : null }
}
function ratio(numerator: bigint, denominator: bigint): string {
  if (denominator === 0n) return '0'
  const scale = 10n ** 320n
  const value = numerator * scale / denominator
  return `${value / scale}.${(value % scale).toString().padStart(320, '0')}`.replace(/\.?0+$/, '')
}
export async function resolvePool(url: URL, block: Block, upstreamFetch: typeof fetch): Promise<Pool> {
  const id = url.searchParams.get('pool')
  if (id === null || !/^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(id)) throw new BadRequest('Invalid pool')
  const known = knownPools().find((pool) => same(pool.id, id))
  if (known) return known
  const base = { id: id.toLowerCase(), createdBlock: null, source: 'chain' as const, sqrtPriceX96: null, tick: null, liquidity: null, stateError: null }
  if (id.length === 42) {
    const [factory, token0, token1, fee, tickSpacing] = await Promise.all(['factory', 'token0', 'token1', 'fee', 'tickSpacing'].map((name) => call(V3_POOL_READ, id, name, [], hex(block.number), upstreamFetch)))
    if (typeof factory !== 'string' || !same(factory, deployment.contracts.v3Factory) || typeof token0 !== 'string' || typeof token1 !== 'string' || typeof fee !== 'number' || typeof tickSpacing !== 'number') throw new BadRequest('Foreign pool')
    const registered = await call(FACTORY_READ, deployment.contracts.v3Factory, 'getPool', [token0, token1, fee], hex(block.number), upstreamFetch)
    if (typeof registered !== 'string' || !same(registered, id)) throw new BadRequest('Foreign pool')
    return { ...base, protocol: 'v3', address: id, token0, token1, fee, tickSpacing, hooks: ZERO }
  }
  const token0 = url.searchParams.get('token0'), token1 = url.searchParams.get('token1'), hooks = url.searchParams.get('hooks') ?? ZERO
  const fee = Number(url.searchParams.get('fee')), tickSpacing = Number(url.searchParams.get('tickSpacing'))
  if (!token0 || !token1 || ![token0, token1, hooks].every((value) => /^0x[0-9a-fA-F]{40}$/.test(value)) || BigInt(token0) >= BigInt(token1) || !same(hooks, ZERO) || !Number.isInteger(fee) || fee < 0 || fee > 1_000_000 || !Number.isInteger(tickSpacing) || tickSpacing <= 0 || tickSpacing > 32767 || !same(poolId(token0, token1, fee, tickSpacing, hooks), id)) throw new BadRequest('V4 pool metadata required')
  return { ...base, protocol: 'v4', address: null, token0, token1, fee, tickSpacing, hooks }
}
export async function market(url: URL, block: Block, range: Coverage, upstreamFetch: typeof fetch): Promise<object> {
  const base = await resolvePool(url, block, upstreamFetch)
  const [pool, token0, token1] = await Promise.all([snapshot(base, block, upstreamFetch), token(base.token0, block, upstreamFetch), token(base.token1, block, upstreamFetch)])
  const swaps = await logs([base.address ?? deployment.contracts.v4PoolManager], range.fromBlock, range.toBlock, base.protocol === 'v3' ? [toEventSelector(EVENTS[2])] : [toEventSelector(EVENTS[3]), base.id as `0x${string}`], upstreamFetch)
  let volume0 = 0n, volume1 = 0n, fees0 = 0n, fees1 = 0n
  const priceHistory: { blockNumber: number; logIndex: number; sqrtPriceX96: string }[] = []
  for (const log of swaps) {
    const { args } = decodeLog(log)
    if (typeof args.sqrtPriceX96 === 'bigint') priceHistory.push({ blockNumber: Number(BigInt(log.blockNumber)), logIndex: Number(BigInt(log.logIndex)), sqrtPriceX96: String(args.sqrtPriceX96) })
    if (typeof args.amount0 !== 'bigint' || typeof args.amount1 !== 'bigint') continue
    volume0 += args.amount0 < 0n ? -args.amount0 : args.amount0
    volume1 += args.amount1 < 0n ? -args.amount1 : args.amount1
    const fee = BigInt(base.protocol === 'v3' ? base.fee : Number(args.fee))
    if (base.protocol === 'v3' ? args.amount0 > 0n : args.amount0 < 0n) fees0 += (args.amount0 < 0n ? -args.amount0 : args.amount0) * fee / 1_000_000n
    if (base.protocol === 'v3' ? args.amount1 > 0n : args.amount1 < 0n) fees1 += (args.amount1 < 0n ? -args.amount1 : args.amount1) * fee / 1_000_000n
  }
  let reserve0: string | null = null, reserve1: string | null = null
  if (base.address) {
    try {
      const values = await Promise.all([base.token0, base.token1].map((address) => call(ERC20_READ, address, 'balanceOf', [base.address], hex(block.number), upstreamFetch)))
      if (values.every((value) => typeof value === 'bigint')) [reserve0, reserve1] = values.map(String)
    } catch { /* A failed reserve read is represented as unavailable, never a zero. */ }
  }
  const price = pool.sqrtPriceX96 !== null && BigInt(pool.sqrtPriceX96) > 0n && token0.decimals !== null && token1.decimals !== null ? ratio(BigInt(pool.sqrtPriceX96) ** 2n * 10n ** BigInt(token0.decimals), 2n ** 192n * 10n ** BigInt(token1.decimals)) : null
  return { schemaVersion: 1, chainId: 196, asOf: block, coverage: range, pool, token0, token1, priceToken1PerToken0: price, priceHistory, volume: { token0Raw: String(volume0), token1Raw: String(volume1) }, fees: { token0Raw: String(fees0), token1Raw: String(fees1), reason: 'Estimated input fee over covered blocks; not claimable LP income' }, reserves: { token0Raw: reserve0, token1Raw: reserve1, reason: base.protocol === 'v4' ? 'Singleton balance cannot be attributed to one pool' : reserve0 === null ? 'Reserve read unavailable' : null }, tvlUsd: null, apr: null, unavailableReasons: ['Independent USD prices unavailable', 'No persistent time-series index for APR'] }
}
