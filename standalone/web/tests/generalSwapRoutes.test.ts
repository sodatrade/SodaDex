import { describe, expect, it, vi } from 'vitest'
import { zeroAddress } from 'viem'
import { KNOWN_CURRENCIES } from '../src/liquidity/config'
import type { Currency, LiquidityPool } from '../src/liquidity/types'
import { WOKB_ADDRESS } from '../src/domain/assets'
import { bestPoolQuote, matchingPools, priceImpact, slippageValue, wrapDirection } from '../src/features/swap/routes'
import * as trades from '../src/trading/poolTrade'
const [native, wrapped, stable] = KNOWN_CURRENCIES
const pool: LiquidityPool = { protocol: 'v3', id: '0x1111111111111111111111111111111111111111', address: '0x1111111111111111111111111111111111111111',
  currency0: { ...native, address: WOKB_ADDRESS }, currency1: stable, fee: 500, tickSpacing: 10, sqrtPriceX96: 2n ** 96n, tick: 0, liquidity: 1n, initialized: true }
describe('registered pool selection', () => {
  it('supports new pairs and preserves fee and native or wrapped payment intent', () => {
    const custom: Currency = { address: '0x3333333333333333333333333333333333333333', decimals: 8, name: 'Custom', symbol: 'CUSTOM', native: false }
    const created = { ...pool, currency1: custom }
    const nativeMatch = matchingPools([created], native, custom, 'auto')[0]
    expect(nativeMatch.pool.fee).toBe(500)
    expect(nativeMatch.pool.currency0).toMatchObject({ native: true, address: WOKB_ADDRESS })
    expect(matchingPools([created], wrapped, custom, 'v3')[0].pool.currency0).toMatchObject({ native: false, address: WOKB_ADDRESS, symbol: 'WOKB' })
    expect(matchingPools([created], custom, native, 'v3')[0].zeroForOne).toBe(false)
  })
  it('rejects native V4 for WOKB and excludes uninitialized or empty pools', () => {
    const v4 = { ...pool, protocol: 'v4' as const, currency0: { ...native, address: zeroAddress } }
    expect(matchingPools([v4], wrapped, stable, 'auto')).toHaveLength(0)
    expect(matchingPools([v4], native, stable, 'auto')).toHaveLength(1)
    expect(matchingPools([{ ...pool, initialized: false }], native, stable, 'auto')).toHaveLength(0)
    expect(matchingPools([{ ...pool, liquidity: 0n }], native, stable, 'auto')).toHaveLength(0)
    expect(matchingPools([pool], native, stable, 'v4')).toHaveLength(0)
  })
  it('chooses the largest successful quote while another pool is unavailable', async () => {
    const spy = vi.spyOn(trades, 'getPoolTradeQuote').mockImplementation(async (p, zeroForOne, amount, slippageBps = 50) => {
      if (p.fee === 3000) throw new Error('No liquidity')
      return { pool: p, zeroForOne, amount, slippageBps, amountOut: p.fee === 500 ? 1000n : 999n, minimumOut: 990n }
    })
    const candidates = matchingPools([pool, { ...pool, fee: 100 }, { ...pool, fee: 3000 }], native, stable, 'auto')
    expect((await bestPoolQuote(candidates, 100n, 75)).pool.fee).toBe(500)
    expect(spy).toHaveBeenCalledWith(expect.anything(), true, 100n, 75); spy.mockRestore()
  })
  it('recognizes only official wrap pairs and exact slippage decimals', () => {
    expect(wrapDirection(native, wrapped)).toBe('wrap'); expect(wrapDirection(wrapped, native)).toBe('unwrap')
    expect(wrapDirection(native, stable)).toBeUndefined()
    expect(slippageValue('0.5')).toBe(50); expect(slippageValue('2.35')).toBe(235)
    for (const v of ['0', '100', '-1', '0.001', 'no']) expect(slippageValue(v)).toBeUndefined()
  })
  it('measures price impact after fees with integer arithmetic', () => {
    expect(priceImpact({ pool: { ...pool, fee: 0 }, zeroForOne: true, amount: 10000n, amountOut: 9800n, minimumOut: 9751n, slippageBps: 50 })).toBe('2.00%')
    expect(priceImpact({ pool: { ...pool, fee: 10000 }, zeroForOne: true, amount: 10000n, amountOut: 9900n, minimumOut: 9850n, slippageBps: 50 })).toBe('0.00%')
  })
})
