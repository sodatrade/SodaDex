import { describe, expect, it } from 'vitest'
import { chartCandles, chartPrice } from '../src/dex-chart-math'
import { CHART_INTERVALS, type ChartTrade } from '../src/dex-chart-types'
import { Q96 } from './dex-chart-fixtures'
function trade(timestamp: number, sqrt: bigint, amount = 1n): ChartTrade {
  return { id: String(timestamp), blockNumber: timestamp, blockHash: '0x', transactionHash: '0x', logIndex: 0, timestamp, amount0Raw: String(amount), amount1Raw: '-2', volume0Raw: String(amount), volume1Raw: '2', sqrtPriceX96: String(sqrt), priceToken1PerToken0: chartPrice(String(sqrt), 6, 6), sender: '0x', recipient: null }
}
describe('exact chart arithmetic', () => {
  it('scales token decimals and retains values below 1e-290 without floating point rounding', () => {
    expect(chartPrice(String(Q96), 6, 18)).toBe('0.000000000001')
    expect(chartPrice(String(2n * Q96), 6, 6)).toBe('4')
    expect(chartPrice('4295128739', 0, 255)).not.toBe('0')
    expect(chartPrice('4295128739', 0, 255)?.length).toBeGreaterThan(290)
    expect(chartPrice(String(Q96), null, 18)).toBeNull()
    expect(chartPrice(String(Q96), 256, 18)).toBeNull()
  })
  it('builds actual OHLC and exact raw volume in chronological trade order', () => {
    const trades = [trade(3600, Q96, 2n ** 80n), trade(3601, Q96 * 2n), trade(3602, Q96 / 2n), trade(3603, Q96 * 3n / 2n)]
    const candles = chartCandles(trades, '1h')
    expect(candles).toHaveLength(1)
    expect(candles[0]).toMatchObject({ time: 3600, bucketEndTime: 7200, open: '1', high: '4', low: '0.25', close: '2.25', volume0Raw: String(2n ** 80n + 3n), volume1Raw: '8', tradeCount: 4 })
  })
  it.each(Object.keys(CHART_INTERVALS) as (keyof typeof CHART_INTERVALS)[])('aligns %s to UTC Unix buckets and does not fill untraded gaps', (interval) => {
    const size = CHART_INTERVALS[interval]
    const candles = chartCandles([trade(size + 1, Q96), trade(size * 3 + 1, Q96)], interval)
    expect(candles.map((candle) => candle.time)).toEqual([size, size * 3])
    expect(chartCandles([], interval)).toEqual([])
  })
})
