import type { AnyPool } from '../../liquidity/v2Types'
import { hasSwapLiquidity } from './poolCurrencies'
import { WOKB_ADDRESS, type Protocol } from '../../domain/assets'
import type { Currency } from '../../liquidity/types'
import { getPoolTradeQuote, type PoolTradeQuote } from '../../trading/poolTrade'
import { getPoolExactOutputQuote, type PoolExactOutputQuote } from '../../trading/poolExactOutput'
export type SwapPoolQuote = PoolTradeQuote | PoolExactOutputQuote
export function isExactOutput(quote: SwapPoolQuote): quote is PoolExactOutputQuote { return 'tradeType' in quote && quote.tradeType === 'exactOutput' }
export function quotedInput(quote: SwapPoolQuote): bigint { return isExactOutput(quote) ? quote.amountIn : quote.amount }
export const currencyKey = (c: Currency): string => c.native ? 'native' : c.address.toLowerCase()
export function sameCurrency(a: Currency, b: Currency): boolean { return currencyKey(a) === currencyKey(b) }
function compatible(selected: Currency, pool: Currency, protocol: string): boolean {
  if (selected.native) return pool.native || ((protocol === 'v3' || protocol === 'v2') && pool.address.toLowerCase() === WOKB_ADDRESS.toLowerCase())
  return selected.address.toLowerCase() === pool.address.toLowerCase() && (!pool.native || (protocol === 'v3' || protocol === 'v2'))
}
/** Preserve the user's native/erc20 payment intent while retaining the registered pool key. */
export function matchingPools(pools: AnyPool[], from: Currency, to: Currency, protocol: Protocol): { pool: AnyPool; zeroForOne: boolean }[] {
  if (sameCurrency(from, to)) return []
  return pools.flatMap((pool) => {
    if (!hasSwapLiquidity(pool) || (protocol !== 'auto' && pool.protocol !== protocol)) return []
    const direct = compatible(from, pool.currency0, pool.protocol) && compatible(to, pool.currency1, pool.protocol)
    const reverse = compatible(from, pool.currency1, pool.protocol) && compatible(to, pool.currency0, pool.protocol)
    if (!direct && !reverse) return []
    const selected0 = direct ? from : to, selected1 = direct ? to : from
    const intent = (original: Currency, selected: Currency): Currency => ({ ...selected, address: original.address })
    return [{ pool: { ...pool, currency0: intent(pool.currency0, selected0), currency1: intent(pool.currency1, selected1) }, zeroForOne: direct }]
  })
}
export async function bestPoolQuote(candidates: ReturnType<typeof matchingPools>, amount: bigint, slippageBps: number): Promise<PoolTradeQuote> {
  const results = await Promise.allSettled(candidates.map(({ pool, zeroForOne }) => getPoolTradeQuote(pool, zeroForOne, amount, slippageBps)))
  const valid = results.flatMap((r) => r.status === 'fulfilled' ? [r.value] : [])
  if (!valid.length) throw new Error('No route')
  return valid.reduce((best, quote) => quote.amountOut > best.amountOut ? quote : best)
}
export async function bestPoolExactOutputQuote(candidates: ReturnType<typeof matchingPools>, amountOut: bigint, slippageBps: number): Promise<PoolExactOutputQuote> {
  const results = await Promise.allSettled(candidates.map(({ pool, zeroForOne }) => getPoolExactOutputQuote(pool, zeroForOne, amountOut, slippageBps)))
  const valid = results.flatMap((r) => r.status === 'fulfilled' ? [r.value] : [])
  if (!valid.length) throw new Error('No route')
  return valid.reduce((best, quote) => quote.amountIn < best.amountIn ? quote : best)
}
export function wrapDirection(from: Currency, to: Currency): 'wrap' | 'unwrap' | undefined {
  if (from.native && !to.native && to.address.toLowerCase() === WOKB_ADDRESS.toLowerCase()) return 'wrap'
  if (to.native && !from.native && from.address.toLowerCase() === WOKB_ADDRESS.toLowerCase()) return 'unwrap'
  return undefined
}
export function slippageValue(value: string): number | undefined {
  if (!/^\d+(\.\d{0,2})?$/.test(value)) return undefined
  const [whole, fraction = ''] = value.split('.')
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isInteger(bps) && bps > 0 && bps < 10000 ? bps : undefined
}
export function priceImpact(quote: SwapPoolQuote): string | undefined {
  const squared = quote.pool.protocol === 'v2' ? quote.pool.reserve1 : quote.pool.sqrtPriceX96 ** 2n, scale = quote.pool.protocol === 'v2' ? quote.pool.reserve0 : 2n ** 192n
  if (!squared) return undefined
  const afterFee = quotedInput(quote) * BigInt(1000000 - quote.pool.fee)
  const spotOut = quote.zeroForOne ? afterFee * squared / (1000000n * scale) : afterFee * scale / (1000000n * squared)
  if (spotOut <= 0n) return undefined
  const bps = (spotOut - quote.amountOut) * 10000n / spotOut
  return `${bps < 0n ? '−' : ''}${(bps < 0n ? -bps : bps) / 100n}.${((bps < 0n ? -bps : bps) % 100n).toString().padStart(2, '0')}%`
}
