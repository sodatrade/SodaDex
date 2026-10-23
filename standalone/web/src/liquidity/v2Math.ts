import { LiquidityError } from './types'

export function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new LiquidityError('invalidAmount')
  if (value < 2n) return value
  let x = value, y = (x + 1n) / 2n
  while (y < x) { x = y; y = (x + value / x) / 2n }
  return x
}
export function v2Supply(supply: bigint, reserve0: bigint, reserve1: bigint, kLast: bigint, feeOn: boolean): bigint {
  if (!feeOn || !kLast) return supply
  const root = integerSqrt(reserve0 * reserve1), previous = integerSqrt(kLast)
  return root > previous ? supply + supply * (root - previous) / (root * 5n + previous) : supply
}
export function v2Deposit(desired0: bigint, desired1: bigint, reserve0: bigint, reserve1: bigint): readonly [bigint, bigint] {
  if (desired0 <= 0n || desired1 <= 0n) throw new LiquidityError('invalidAmount')
  if (!reserve0 && !reserve1) return [desired0, desired1]
  if (reserve0 <= 0n || reserve1 <= 0n) throw new LiquidityError('invalidPool')
  const optimal1 = desired0 * reserve1 / reserve0
  const result = optimal1 <= desired1 ? [desired0, optimal1] as const : [desired1 * reserve0 / reserve1, desired1] as const
  if (result[0] <= 0n || result[1] <= 0n) throw new LiquidityError('invalidAmount')
  return result
}
export function v2Minimum(amount: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10000) throw new LiquidityError('invalidSlippage')
  const minimum = amount * BigInt(10000 - slippageBps) / 10000n
  if (amount <= 0n) throw new LiquidityError('invalidAmount')
  return minimum > 0n ? minimum : 1n
}
