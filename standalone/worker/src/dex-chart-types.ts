import type { Block, Coverage, Pool } from './dex-data'
export const CHART_INTERVALS = { '1m': 60, '5m': 300, '1h': 3600, '4h': 14400, '1d': 86400 } as const
export type ChartInterval = keyof typeof CHART_INTERVALS
export interface ChartToken { address: string; symbol: string | null; name: string | null; decimals: number | null }
export interface ChartTrade {
  priceSource?: 'v2-reserves'
  id: string; blockNumber: number; blockHash: string; transactionHash: string; logIndex: number; timestamp: number
  amount0Raw: string; amount1Raw: string; volume0Raw: string; volume1Raw: string
  sqrtPriceX96: string; priceToken1PerToken0: string | null; sender: string; recipient: string | null
}
export interface ChartCandle {
  time: number; bucketEndTime: number; open: string | null; high: string | null; low: string | null; close: string | null
  sqrtPriceOpenX96: string; sqrtPriceHighX96: string; sqrtPriceLowX96: string; sqrtPriceCloseX96: string
  volume0Raw: string; volume1Raw: string; tradeCount: number; firstBlock: number; lastBlock: number
}
/** Each response is cumulative for this immutable scan; replace rather than append arrays. */
export interface ChartResponse {
  schemaVersion: 1; chainId: 196; asOf: Block; coverage: Coverage; pool: Pool; token0: ChartToken; token1: ChartToken
  interval: ChartInterval; query: { fromBlock: number; toBlock: number }; priceToken1PerToken0: string | null
  priceUnavailableReason: string | null; candles: ChartCandle[]; trades: ChartTrade[]; queryComplete: boolean; nextCursor: string | null
}
