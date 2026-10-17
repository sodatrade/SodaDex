import { Percent, Token } from '@uniswap/sdk-core'
import { Pool as V3Pool, Position as V3Position, TickMath, encodeSqrtRatioX96 } from '@uniswap/v3-sdk'
import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk'
import { parseUnits, zeroAddress } from 'viem'
import { LP_CHAIN_ID } from './config'
import { LiquidityError, type Currency, type LiquidityPool } from './types'
export function fullRange(tickSpacing: number): { tickLower: number; tickUpper: number } {
  if (!Number.isInteger(tickSpacing) || tickSpacing < 1 || tickSpacing > 32767) throw new LiquidityError('invalidRange')
  return {
    tickLower: Math.ceil(TickMath.MIN_TICK / tickSpacing) * tickSpacing,
    tickUpper: Math.floor(TickMath.MAX_TICK / tickSpacing) * tickSpacing,
  }
}
export function validateRange(pool: LiquidityPool, lower: number, upper: number): void {
  const range = fullRange(pool.tickSpacing)
  if (
    !Number.isInteger(lower) ||
    !Number.isInteger(upper) ||
    lower >= upper ||
    lower < range.tickLower ||
    upper > range.tickUpper ||
    lower % pool.tickSpacing !== 0 ||
    upper % pool.tickSpacing !== 0
  )
    throw new LiquidityError('invalidRange')
}
const token = (c: Currency): Token => new Token(LP_CHAIN_ID, c.address, c.decimals, c.symbol, c.name)
export function sdkPool(pool: LiquidityPool): V3Pool | V4Pool {
  if (!pool.initialized || pool.sqrtPriceX96 <= 0n) throw new LiquidityError('invalidPool')
  return pool.protocol === 'v3'
    ? new V3Pool(
        token(pool.currency0),
        token(pool.currency1),
        pool.fee,
        pool.sqrtPriceX96.toString(),
        pool.liquidity.toString(),
        pool.tick,
      )
    : new V4Pool(
        token(pool.currency0),
        token(pool.currency1),
        pool.fee,
        pool.tickSpacing,
        zeroAddress,
        pool.sqrtPriceX96.toString(),
        pool.liquidity.toString(),
        pool.tick,
      )
}
export function positionFromAmounts(
  pool: LiquidityPool,
  lower: number,
  upper: number,
  amount0: bigint,
  amount1: bigint,
): V3Position | V4Position {
  validateRange(pool, lower, upper)
  if (amount0 < 0n || amount1 < 0n) throw new LiquidityError('invalidAmount')
  const p = sdkPool(pool),
    args = {
      tickLower: lower,
      tickUpper: upper,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      useFullPrecision: true,
    }
  return p instanceof V3Pool
    ? V3Position.fromAmounts({ ...args, pool: p })
    : V4Position.fromAmounts({ ...args, pool: p })
}
export function positionForLiquidity(
  pool: LiquidityPool,
  lower: number,
  upper: number,
  liquidity: bigint,
): V3Position | V4Position {
  validateRange(pool, lower, upper)
  const p = sdkPool(pool),
    args = { tickLower: lower, tickUpper: upper, liquidity: liquidity.toString() }
  return p instanceof V3Pool ? new V3Position({ ...args, pool: p }) : new V4Position({ ...args, pool: p })
}
export function initializePrice(pool: LiquidityPool, price: string): LiquidityPool {
  if (!/^\d+(\.\d{1,18})?$/.test(price) || parseUnits(price, 18) <= 0n) throw new LiquidityError('invalidPool')
  const sqrt = BigInt(
    encodeSqrtRatioX96(
      (parseUnits(price, 18) * 10n ** BigInt(pool.currency1.decimals)).toString(),
      (10n ** 18n * 10n ** BigInt(pool.currency0.decimals)).toString(),
    ).toString(),
  )
  if (sqrt <= BigInt(TickMath.MIN_SQRT_RATIO.toString()) || sqrt >= BigInt(TickMath.MAX_SQRT_RATIO.toString()))
    throw new LiquidityError('invalidPool')
  return {
    ...pool,
    sqrtPriceX96: sqrt,
    tick: TickMath.getTickAtSqrtRatio(
      encodeSqrtRatioX96(
        (parseUnits(price, 18) * 10n ** BigInt(pool.currency1.decimals)).toString(),
        (10n ** 18n * 10n ** BigInt(pool.currency0.decimals)).toString(),
      ),
    ),
    initialized: true,
  }
}
export const slippagePercent = (bps: number): Percent => {
  if (!Number.isInteger(bps) || bps < 0 || bps >= 10000) throw new LiquidityError('invalidSlippage')
  return new Percent(bps, 10000)
}
export const feeDelta = (current: bigint, last: bigint, liquidity: bigint): bigint =>
  (BigInt.asUintN(256, current - last) * liquidity) / (1n << 128n)
