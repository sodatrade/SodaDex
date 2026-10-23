import type { AnyPool } from '../liquidity/v2Types'

/** Standard non-taxed, non-rebasing assets only. Amounts are exact raw token units. */
export interface PoolExactOutputQuote<P extends AnyPool = AnyPool> {
  tradeType: 'exactOutput'
  pool: P
  zeroForOne: boolean
  amountOut: bigint
  amountIn: bigint
  maximumIn: bigint
  slippageBps: number
}
