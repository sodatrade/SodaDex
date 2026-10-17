import { CHART_INTERVALS, type ChartCandle, type ChartInterval, type ChartTrade } from './dex-chart-types'

/** Exact positive pool ratio, rounded down only after 320 decimal places. */
export function chartPrice(sqrtPriceX96: string, decimals0: number | null, decimals1: number | null): string | null {
  if (decimals0 === null || decimals1 === null || !Number.isInteger(decimals0) || !Number.isInteger(decimals1) || decimals0 < 0 || decimals0 > 255 || decimals1 < 0 || decimals1 > 255 || !/^[0-9]+$/.test(sqrtPriceX96)) return null
  const sqrt = BigInt(sqrtPriceX96)
  if (sqrt === 0n) return null
  const precision = 10n ** 320n
  const scaled = sqrt * sqrt * 10n ** BigInt(decimals0) * precision / (2n ** 192n * 10n ** BigInt(decimals1))
  return `${scaled / precision}.${(scaled % precision).toString().padStart(320, '0')}`.replace(/\.?0+$/, '')
}
/** Input order is canonical block/log order with verified nondecreasing timestamps. */
export function chartCandles(trades: readonly ChartTrade[], interval: ChartInterval): ChartCandle[] {
  const seconds = CHART_INTERVALS[interval]
  const candles: ChartCandle[] = []
  for (const trade of trades) {
    const time = Math.floor(trade.timestamp / seconds) * seconds
    const previous = candles.at(-1)
    if (!previous || previous.time !== time) {
      candles.push({ time, bucketEndTime: time + seconds, open: trade.priceToken1PerToken0, high: trade.priceToken1PerToken0, low: trade.priceToken1PerToken0, close: trade.priceToken1PerToken0, sqrtPriceOpenX96: trade.sqrtPriceX96, sqrtPriceHighX96: trade.sqrtPriceX96, sqrtPriceLowX96: trade.sqrtPriceX96, sqrtPriceCloseX96: trade.sqrtPriceX96, volume0Raw: trade.volume0Raw, volume1Raw: trade.volume1Raw, tradeCount: 1, firstBlock: trade.blockNumber, lastBlock: trade.blockNumber })
      continue
    }
    previous.close = trade.priceToken1PerToken0
    previous.sqrtPriceCloseX96 = trade.sqrtPriceX96
    previous.lastBlock = trade.blockNumber
    previous.volume0Raw = String(BigInt(previous.volume0Raw) + BigInt(trade.volume0Raw))
    previous.volume1Raw = String(BigInt(previous.volume1Raw) + BigInt(trade.volume1Raw))
    previous.tradeCount++
    if (BigInt(trade.sqrtPriceX96) > BigInt(previous.sqrtPriceHighX96)) {
      previous.high = trade.priceToken1PerToken0
      previous.sqrtPriceHighX96 = trade.sqrtPriceX96
    }
    if (BigInt(trade.sqrtPriceX96) < BigInt(previous.sqrtPriceLowX96)) {
      previous.low = trade.priceToken1PerToken0
      previous.sqrtPriceLowX96 = trade.sqrtPriceX96
    }
  }
  return candles
}
