/** Display-only prices derived from canonical trade events, never execution quotes. */
export const MINING_MARKET_INTERVALS = { '1m': 60, '5m': 300, '1h': 3600, '4h': 14400, '1d': 86400 } as const
export type MiningMarketInterval = keyof typeof MINING_MARKET_INTERVALS
export interface MiningMarketTrade {
  id: string; transactionHash: string; timestamp: number; blockNumber: number
  source: 'curve' | 'pair' | 'fragments'; buy: boolean; assetRaw: string; fabRaw: string; price: string
}
export interface MiningMarketCandle { time: number; open: string; high: string; low: string; close: string; trades: number }
export function miningTradePrice(asset: bigint, fab: bigint): string {
  if (asset <= 0n || fab <= 0n) throw Error('Invalid trade amounts')
  // Project tokens and fragments use 18 decimals; the deployed TEST-FAB uses 8.
  const scaled = fab * 10n ** 46n / asset
  return `${scaled / 10n ** 36n}.${(scaled % 10n ** 36n).toString().padStart(36, '0')}`
}
const exact = (price: string): bigint => BigInt(price.replace('.', ''))
export function miningCandles(trades: readonly MiningMarketTrade[], interval: MiningMarketInterval): MiningMarketCandle[] {
  const result: MiningMarketCandle[] = [], seconds = MINING_MARKET_INTERVALS[interval]
  for (const trade of trades) {
    const time = Math.floor(trade.timestamp / seconds) * seconds, previous = result.at(-1)
    if (!previous || previous.time !== time) result.push({ time, open: trade.price, high: trade.price, low: trade.price, close: trade.price, trades: 1 })
    else {
      previous.close = trade.price; previous.trades++
      if (exact(trade.price) > exact(previous.high)) previous.high = trade.price
      if (exact(trade.price) < exact(previous.low)) previous.low = trade.price
    }
  }
  return result
}
