import type { AnyPool } from '../liquidity/v2Types'
import { isAddress, zeroAddress } from 'viem'
import { WOKB_ADDRESS } from '../domain/assets'
import { validateCurrency } from '../liquidity/currencies'
import { poolId } from '../liquidity/pools'
import type { Currency } from '../liquidity/types'
import { TradeError } from './types'
import type { PoolTradeQuote } from './poolTradeTypes'
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** Validate the selected key before using it in either quote or transaction calldata. */
export function assertTradePool(pool: AnyPool): void {
  try {
    for (const c of [pool.currency0, pool.currency1]) {
      validateCurrency(c)
      if ((pool.protocol === 'v2' || pool.protocol === 'v3') && (c.address === zeroAddress || (c.native && !same(c.address, WOKB_ADDRESS))))
        throw new Error('Invalid V3 currency')
      if (pool.protocol === 'v4' && (c.native !== (c.address === zeroAddress)))
        throw new Error('Invalid V4 currency')
    }
    if (pool.protocol === 'v2') {
      if (!pool.initialized || pool.reserve0 <= 0n || pool.reserve1 <= 0n || pool.totalSupply <= 0n || pool.fee !== 3000 ||
        BigInt(pool.currency0.address) >= BigInt(pool.currency1.address) || !pool.address || !isAddress(pool.address) ||
        pool.address === zeroAddress || !same(pool.id, pool.address)) throw new Error('Invalid V2 pool')
      return
    }
    if (!pool.initialized || pool.sqrtPriceX96 <= 0n || BigInt(pool.currency0.address) >= BigInt(pool.currency1.address) ||
      !Number.isInteger(pool.fee) || pool.fee < 0 || pool.fee >= 1_000_000 ||
      !Number.isInteger(pool.tickSpacing) || pool.tickSpacing < 1 || pool.tickSpacing > 32767)
      throw new Error('Invalid pool')
    if (pool.protocol === 'v3') {
      if (!pool.address || !isAddress(pool.address) || pool.address === zeroAddress || !same(pool.id, pool.address))
        throw new Error('Invalid pool address')
    } else if (pool.protocol !== 'v4' || !same(pool.id, poolId(pool))) throw new Error('Invalid pool ID')
  } catch {
    throw new TradeError('tradeUnsupported')
  }
}
export function poolTradeCurrencies(quote: Pick<PoolTradeQuote, 'pool' | 'zeroForOne'>): readonly [Currency, Currency] {
  return quote.zeroForOne ? [quote.pool.currency0, quote.pool.currency1] : [quote.pool.currency1, quote.pool.currency0]
}
