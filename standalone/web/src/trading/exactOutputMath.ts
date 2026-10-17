import { minimumOutput } from './encoding'
import { TradeError } from './types'

/** Same slippage policy as exact-input; round the maximum spend up, never down. */
export function maximumInput(amountIn: bigint, slippageBps: number): bigint {
  minimumOutput(1n, slippageBps)
  if (amountIn <= 0n || amountIn >= 2n ** 128n) throw new TradeError('tradeUnavailable')
  const maximum = (amountIn * (10_000n + BigInt(slippageBps)) + 9_999n) / 10_000n
  if (maximum >= 2n ** 128n) throw new TradeError('tradeUnavailable')
  return maximum
}
