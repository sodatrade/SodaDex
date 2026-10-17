import { isAddress, type Address } from 'viem'
export interface ReferenceToken {
  chainId: 196; address: Address; symbol: string | null; name: string | null; decimals: number | null
  logoURI: string | null; metadataSource: string; metadataError: string | null
}
export interface ReferencePool {
  protocol: 'v2' | 'v3' | 'v4'; source: 'uniswap'; readOnly: true; id: string; address: Address | null
  token0: ReferenceToken; token1: ReferenceToken; fee: number; tickSpacing: number | null; hooks: string | null
  sqrtPriceX96: string | null; tick: number | null; liquidity: string | null
  reserves: { token0Raw: string | null; token1Raw: string | null }; priceToken1PerToken0: string | null; stateError: string | null
}
export interface ReferencePools {
  schemaVersion: 1; chainId: 196; source: 'uniswap'; readOnly: true; pools: ReferencePool[]
  asOf: { number: number; hash: string; timestamp: number }
  errors: { protocol: string; fee: number | null; tickSpacing: number | null; message: string }[]
}
export interface ReferenceQuote {
  schemaVersion: 1; chainId: 196; source: 'uniswap'; readOnly: true; amountInRaw: string; amountOutRaw: string
  tokenIn: string; tokenOut: string; protocol: string; poolId: string
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const raw = (v: unknown): boolean => typeof v === 'string' && /^\d+$/.test(v)
const address = (v: unknown): v is Address => typeof v === 'string' && isAddress(v, { strict: false })
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
function envelope(v: unknown): v is Record<string, unknown> {
  return record(v) && v.schemaVersion === 1 && v.chainId === 196 && v.source === 'uniswap' && v.readOnly === true
}
function token(v: unknown): v is ReferenceToken {
  return record(v) && v.chainId === 196 && address(v.address) && (v.symbol === null || typeof v.symbol === 'string') &&
    (v.name === null || typeof v.name === 'string') && (v.decimals === null || (integer(v.decimals) && v.decimals <= 255))
}
function pool(v: unknown): boolean {
  return record(v) && v.source === 'uniswap' && v.readOnly === true && ['v2', 'v3', 'v4'].includes(String(v.protocol)) &&
    typeof v.id === 'string' && /^0x[\da-f]{40}([\da-f]{24})?$/i.test(v.id) && (v.address === null || address(v.address)) &&
    token(v.token0) && token(v.token1) && integer(v.fee) && (v.tickSpacing === null || integer(v.tickSpacing)) &&
    (v.stateError === null || typeof v.stateError === 'string') && record(v.reserves) &&
    (v.reserves.token0Raw === null || raw(v.reserves.token0Raw)) && (v.reserves.token1Raw === null || raw(v.reserves.token1Raw))
}
async function get(path: string): Promise<unknown> {
  const response = await fetch(path, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw Error('Reference data unavailable')
  return response.json()
}
export async function getReferenceTokens(): Promise<ReferenceToken[]> {
  const value = await get('/api/reference/tokens')
  if (!envelope(value) || !Array.isArray(value.tokens) || !value.tokens.every(token)) throw Error('Invalid reference tokens')
  return value.tokens
}
export async function getReferencePools(token0: Address, token1: Address): Promise<ReferencePools> {
  const value = await get(`/api/reference/pools?${new URLSearchParams({ token0, token1 })}`)
  if (!envelope(value) || !Array.isArray(value.pools) || !value.pools.every(pool) || !Array.isArray(value.errors) ||
    !value.errors.every(e => record(e) && typeof e.message === 'string') || !record(value.asOf) || !integer(value.asOf.number))
    throw Error('Invalid reference pools')
  return value as unknown as ReferencePools
}
export async function getReferenceQuote(pool: ReferencePool, direction: boolean, amount: bigint): Promise<ReferenceQuote> {
  const input = direction ? pool.token0 : pool.token1, output = direction ? pool.token1 : pool.token0
  const params = new URLSearchParams({ protocol: pool.protocol, tokenIn: input.address, tokenOut: output.address,
    amountInRaw: amount.toString(), fee: String(pool.fee) })
  if (pool.tickSpacing !== null) params.set('tickSpacing', String(pool.tickSpacing))
  const value = await get(`/api/reference/quote?${params}`)
  if (!envelope(value) || !raw(value.amountOutRaw) || value.amountInRaw !== amount.toString() ||
    typeof value.tokenIn !== 'string' || value.tokenIn.toLowerCase() !== input.address.toLowerCase() ||
    typeof value.tokenOut !== 'string' || value.tokenOut.toLowerCase() !== output.address.toLowerCase() ||
    value.protocol !== pool.protocol || typeof value.poolId !== 'string' || value.poolId.toLowerCase() !== pool.id.toLowerCase())
    throw Error('Invalid reference quote')
  return value as unknown as ReferenceQuote
}
