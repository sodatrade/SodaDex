import { tradePrice, type Trade } from './market'

// Display window only: the index and paginated history retain every trade.
export const RECENT_CHART_TRADES = 50

export interface ChartPoint { x: number; y: number; price: number; trade: Trade }
export interface RecentChart { points: ChartPoint[]; low: number; high: number; path: string; start: number; end: number }

/** Select by trade order before scaling, including when several trades share a timestamp. */
export function recentChart(trades: Trade[]): RecentChart {
  const visible = trades.slice(-RECENT_CHART_TRADES)
  const prices = visible.map(tradePrice)
  const start = visible[0]?.timestamp ?? 0, end = visible.at(-1)?.timestamp ?? start
  if (!prices.length) return { points: [], low: 0, high: 0, path: '', start, end }
  const low = Math.min(...prices), high = Math.max(...prices)
  const padding = (high - low || high * 0.01 || 1) * 0.08
  const floor = Math.max(0, low - padding), ceiling = high + padding
  const points = visible.map((trade, i) => ({ trade, price: prices[i],
    x: 20 + (end > start ? (trade.timestamp - start) / (end - start) : visible.length > 1 ? i / (visible.length - 1) : 0.5) * 600,
    y: 180 - (prices[i] - floor) / (ceiling - floor) * 140,
  }))
  return { points, low: floor, high: ceiling, path: points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '), start, end }
}
