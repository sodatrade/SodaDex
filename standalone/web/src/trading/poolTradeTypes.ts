import type { LiquidityPool } from '../liquidity/types'
export interface PoolTradeQuote {
  pool: LiquidityPool
  zeroForOne: boolean
  amount: bigint
  amountOut: bigint
  minimumOut: bigint
  slippageBps: number
}
