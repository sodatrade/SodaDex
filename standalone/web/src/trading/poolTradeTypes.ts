import type { AnyPool } from '../liquidity/v2Types'
export interface PoolTradeQuote {
  pool: AnyPool
  zeroForOne: boolean
  amount: bigint
  amountOut: bigint
  minimumOut: bigint
  slippageBps: number
}
