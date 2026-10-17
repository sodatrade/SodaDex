import { formatUnits, zeroAddress } from 'viem'
import type { LiquidityPool } from '../../liquidity/types'
import type { ChartCandle, ChartResponse, DexPool } from './api'
export interface PlotCandle { time: number; end: number; open: number; high: number; low: number; close: number; trades: number }
export function chartPool(pool: LiquidityPool): DexPool {
  return { protocol: pool.protocol, id: pool.id, address: pool.address ?? null, token0: pool.currency0.address, token1: pool.currency1.address,
    fee: pool.fee, tickSpacing: pool.tickSpacing, hooks: zeroAddress, createdBlock: null, source: 'chain',
    sqrtPriceX96: pool.sqrtPriceX96.toString(), tick: pool.tick, liquidity: pool.liquidity.toString(), stateError: null }
}
/** Number conversion is restricted to chart display; execution amounts remain exact raw integers. */
export function directionalPrice(price: string | null, reverse: boolean): number | undefined {
  if (price === null) return undefined
  const value = Number(price), result = reverse ? 1 / value : value
  return value > 0 && Number.isFinite(result) && result > 0 ? result : undefined
}
export function displayCandles(candles: ChartCandle[], reverse: boolean): PlotCandle[] {
  return candles.flatMap((c) => {
    const open = directionalPrice(c.open, reverse), close = directionalPrice(c.close, reverse)
    const high = directionalPrice(reverse ? c.low : c.high, reverse), low = directionalPrice(reverse ? c.high : c.low, reverse)
    return open === undefined || close === undefined || high === undefined || low === undefined ? []
      : [{ time: c.time, end: c.bucketEndTime, open, high, low, close, trades: c.tradeCount }]
  })
}
export function scannedVolume(data: ChartResponse, zeroForOne: boolean): { from?: string; to?: string } {
  const total0 = data.candles.reduce((sum, c) => sum + BigInt(c.volume0Raw), 0n)
  const total1 = data.candles.reduce((sum, c) => sum + BigInt(c.volume1Raw), 0n)
  const amount0 = data.token0.decimals === null ? undefined : formatUnits(total0, data.token0.decimals)
  const amount1 = data.token1.decimals === null ? undefined : formatUnits(total1, data.token1.decimals)
  return zeroForOne ? { from: amount0, to: amount1 } : { from: amount1, to: amount0 }
}
export function plotGeometry(candles: PlotCandle[]): { min: number; max: number; x: (time: number) => number; y: (price: number) => number } | undefined {
  if (!candles.length) return undefined
  const min = Math.min(...candles.map((c) => c.low)), max = Math.max(...candles.map((c) => c.high))
  const start = candles[0].time, end = candles.at(-1)!.time
  return { min, max, x: (time) => start === end ? 360 : 12 + (time - start) / (end - start) * 696,
    y: (price) => min === max ? 130 : 242 - (price - min) / (max - min) * 224 }
}
