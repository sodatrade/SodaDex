import { WOKB_ADDRESS } from '../../domain/assets'
import { KNOWN_CURRENCIES } from '../../liquidity/config'
import type { Currency } from '../../liquidity/types'
import type { AnyPool } from '../../liquidity/v2Types'

export function hasSwapLiquidity(pool: AnyPool): boolean {
  return pool.initialized && (pool.protocol === 'v2' ? pool.reserve0 > 0n && pool.reserve1 > 0n : pool.liquidity > 0n)
}

/** Pool discovery supplies the list; saved imports and reference venues cannot add assets. */
export function swapCurrencies(pools: readonly AnyPool[], extension: readonly Currency[] = []): Currency[] {
  const assets = [...extension, ...pools.filter(hasSwapLiquidity).flatMap(pool => [pool.currency0, pool.currency1])]
  const native = assets.some(currency => currency.native || currency.address.toLowerCase() === WOKB_ADDRESS.toLowerCase())
  // Native/WOKB are the same asset in V2/V3 pools and retain the existing 1:1 wrap operation.
  const currencies = [...(native ? KNOWN_CURRENCIES.slice(0, 2) : []), ...assets]
  return currencies.filter((currency, index) => currencies.findIndex(other =>
    currency.native ? other.native : !other.native && other.address.toLowerCase() === currency.address.toLowerCase()) === index)
}
