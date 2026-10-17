import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataError, getChart } from '../src/features/market/api'
import { directionalPrice, displayCandles, plotGeometry, scannedVolume } from '../src/features/market/marketModel'
import { marketContext } from '../src/features/trade/context'
import { KNOWN_CURRENCIES } from '../src/liquidity/config'
import { chartFixture, marketDexPool, marketV3, marketV4 } from './tradeMarketFixture'
afterEach(() => vi.unstubAllGlobals())
describe('directional market display', () => {
  it('inverts OHLC with high and low exchanged, without changing the observed timestamps', () => {
    const candle = { ...chartFixture().candles[0], open: '2', high: '4', low: '1', close: '3' }
    expect(displayCandles([candle], true)[0]).toMatchObject({ time: candle.time, end: candle.bucketEndTime, open: .5, high: 1, low: .25, close: 1 / 3 })
    expect(directionalPrice('0.008', true)).toBe(125)
  })
  it('formats raw 6/18-decimal volumes in the selected direction', () => {
    const data = chartFixture()
    expect(scannedVolume(data, true)).toEqual({ from: '1', to: '0.008' })
    expect(scannedVolume(data, false)).toEqual({ from: '0.008', to: '1' })
    expect(scannedVolume({ ...data, token0: { ...data.token0, decimals: null } }, true)).toEqual({ from: undefined, to: '0.008' })
  })
  it('keeps no trades empty and plots a flat single observation as a finite point', () => {
    expect(displayCandles([], false)).toEqual([]); expect(plotGeometry([])).toBeUndefined()
    const candle = displayCandles(chartFixture().candles, false)[0], geometry = plotGeometry([candle])!
    expect(geometry.x(candle.time)).toBe(360); expect(geometry.y(candle.close)).toBe(130)
    expect(directionalPrice(null, false)).toBeUndefined(); expect(directionalPrice('0', true)).toBeUndefined()
  })
  it('retains actual time gaps instead of distributing observations uniformly', () => {
    const base = displayCandles(chartFixture().candles, false)[0]
    const data = [base, { ...base, time: base.time + 60 }, { ...base, time: base.time + 600 }]
    const geometry = plotGeometry(data)!
    expect(geometry.x(data[1].time) - geometry.x(data[0].time)).toBeCloseTo((geometry.x(data[2].time) - geometry.x(data[0].time)) / 10)
  })
  it('uses a transparent pair pool before quoting and the successful Auto pool afterwards', () => {
    const input = { from: KNOWN_CURRENCIES[0], to: KNOWN_CURRENCIES[2], protocol: 'auto' as const, pools: [marketV3, marketV4], loading: false, failed: false }
    const before = marketContext(input)
    expect(before.mode).toBe('pair'); expect(before.activePool?.id).toBe(marketV3.id); expect(before.candidatePools).toHaveLength(2)
    const after = marketContext({ ...input, quote: { pool: marketV4, zeroForOne: true, amount: 1n, amountOut: 1n, minimumOut: 1n, slippageBps: 50 } })
    expect(after.mode).toBe('quote'); expect(after.activePool?.id).toBe(marketV4.id); expect(after.quotePool?.id).toBe(marketV4.id)
    expect(marketContext({ ...input, failed: true }).activePool).toBeUndefined()
    expect(marketContext({ ...input, to: KNOWN_CURRENCIES[1] }).mode).toBe('wrap')
  })
})
describe('chart transport contract', () => {
  it('preserves the immutable request parameters when appending a cursor', async () => {
    const data = chartFixture(), fetcher = vi.fn(async (_path: string) => new Response(JSON.stringify(data)))
    vi.stubGlobal('fetch', fetcher)
    await getChart(marketDexPool(marketV3), { interval: '5m', fromBlock: 73361037, toBlock: 73365037, cursor: 'opaque' })
    const url = new URL(fetcher.mock.calls[0][0], 'http://localhost')
    expect(url.searchParams.get('cursor')).toBe('opaque'); expect(url.searchParams.get('fromBlock')).toBe('73361037')
    expect(url.searchParams.get('toBlock')).toBe('73365037'); expect(url.searchParams.get('interval')).toBe('5m')
  })

  it.each([
    { code: 'CHART_RANGE_TOO_LARGE' }, { error: 'Chart range exceeds 5000 trades; choose a narrower block range' },
  ])('distinguishes the chart resource limit from an unavailable RPC', async (body) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 400 })))
    await expect(getChart(marketDexPool(marketV3), { interval: '5m' })).rejects.toEqual(new DataError('CHART_RANGE_TOO_LARGE'))
  })
  it.each(['pool', 'interval', 'metadata', 'signed amount', 'completion'] as const)('rejects mismatched %s data', async (failure) => {
    const data = chartFixture()
    if (failure === 'pool') data.pool = marketDexPool(marketV4)
    if (failure === 'interval') data.interval = '1h'
    if (failure === 'metadata') data.token0.address = marketV4.currency0.address
    if (failure === 'signed amount') data.trades[0].amount0Raw = 'bad'
    if (failure === 'completion') data.queryComplete = false
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(data))))
    await expect(getChart(marketDexPool(marketV3), { interval: '5m' })).rejects.toThrow()
  })
})
