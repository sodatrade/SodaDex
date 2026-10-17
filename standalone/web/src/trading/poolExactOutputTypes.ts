import type { LiquidityPool } from '../liquidity/types'

/** Standard non-taxed, non-rebasing assets only. Amounts are exact raw token units. */
export interface PoolExactOutputQuote {
  tradeType: 'exactOutput'
  pool: LiquidityPool
  zeroForOne: boolean
  amountOut: bigint
  amountIn: bigint
  maximumIn: bigint
  slippageBps: number
}
