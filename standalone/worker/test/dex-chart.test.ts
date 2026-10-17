import { describe, expect, it } from 'vitest'
import { dexApi } from '../src/dex-api'
import { FIRST_BLOCK, pools } from '../src/contracts'
import type { ChartResponse } from '../src/dex-chart-types'
import { memoryStore, request } from './dex-fixtures'
import { BASE_TIME, chartFixture, chartPath, chartSwap, Q96 } from './dex-chart-fixtures'
async function response(path: string, source = chartFixture(), store = memoryStore()): Promise<ChartResponse> {
  const result = await dexApi(request(path), source, store)
  expect(result.status).toBe(200)
  return result.json() as Promise<ChartResponse>
}
describe('verified timestamp chart API', () => {
  it('returns real timestamp OHLC, signed amounts, raw volumes and per-pool V4 recipient semantics', async () => {
    const number = FIRST_BLOCK + 10
    const v3 = await response(chartPath(`&fromBlock=${FIRST_BLOCK}&toBlock=${FIRST_BLOCK + 100}`), chartFixture([chartSwap(number, 0), chartSwap(number, 1, Q96 * 2n)]))
    expect(v3.queryComplete).toBe(true)
    expect(v3.trades.map((trade) => trade.timestamp)).toEqual([BASE_TIME + 10, BASE_TIME + 10])
    expect(v3.candles).toHaveLength(1)
    expect(v3.candles[0]).toMatchObject({ open: '1', high: '4', low: '1', close: '4', volume0Raw: '20000', volume1Raw: '40', tradeCount: 2 })
    expect(v3.coverage).toMatchObject({ fromBlock: FIRST_BLOCK, toBlock: FIRST_BLOCK + 100, nextFromBlock: null })
    const v4 = await response(`chart?pool=${pools.v4.poolId}&interval=5m&fromBlock=${FIRST_BLOCK}&toBlock=${FIRST_BLOCK + 100}`, chartFixture([chartSwap(number, 0, Q96, true)]))
    expect(v4.trades[0]).toMatchObject({ amount0Raw: '-10000', amount1Raw: '20', volume0Raw: '10000', volume1Raw: '20', recipient: null })
  })
  it('paginates long block intervals cumulatively, freezes asOf and never duplicates counts on cursor replay', async () => {
    const start = FIRST_BLOCK
    const source = chartFixture([chartSwap(start + 10), chartSwap(start + 4010)])
    const store = memoryStore(), url = chartPath()
    const first = await response(url, source, store)
    expect(first.query).toEqual({ fromBlock: start, toBlock: start + 5000 })
    expect(first.queryComplete).toBe(false)
    expect(first.trades).toHaveLength(1)
    const second = await response(`${url}&cursor=${first.nextCursor}`, source, store)
    expect(second.trades).toHaveLength(1)
    const replay = await response(`${url}&cursor=${first.nextCursor}`, source, store)
    expect(replay.trades).toEqual(second.trades)
    const last = await response(`${url}&cursor=${second.nextCursor}`, source, store)
    expect(last.asOf).toEqual(first.asOf)
    expect(last.queryComplete).toBe(true)
    expect(last.coverage.complete).toBe(true)
    expect(last.trades).toHaveLength(2)
    expect(last.candles.reduce((sum, candle) => sum + candle.tradeCount, 0)).toBe(2)
  })
  it('reads at most eight swap block headers even when the log page contains 1000 distinct blocks', async () => {
    const items = Array.from({ length: 1000 }, (_, index) => chartSwap(FIRST_BLOCK + index))
    const source = chartFixture(items), store = memoryStore()
    const url = chartPath(`&toBlock=${FIRST_BLOCK + 1500}`)
    const first = await response(url, source, store)
    expect(first.trades).toHaveLength(8)
    expect(first.queryComplete).toBe(false)
    expect(first.coverage.toBlock).toBe(FIRST_BLOCK + 7)
    expect(source.mock.calls.length).toBeLessThan(50)
    const calls = source.mock.calls.map(([, options]) => JSON.parse(String(options?.body)) as { method: string; params: string[] })
    const headers = calls.filter((body) => body.method === 'eth_getBlockByNumber' && body.params[0] !== 'latest' && Number(BigInt(body.params[0])) <= FIRST_BLOCK + 999)
    expect(headers).toHaveLength(8)
    source.mockClear()
    const second = await response(`${url}&cursor=${first.nextCursor}`, source, store)
    expect(second.trades).toHaveLength(16)
    expect(source.mock.calls.length).toBeLessThan(50)
    expect(source.mock.calls.map(([, options]) => JSON.parse(String(options?.body)) as { method: string }).some((body) => body.method === 'eth_getLogs')).toBe(false)
  })
  it('deduplicates exact log identities and rejects contradictory payloads instead of double counting', async () => {
    const item = chartSwap(FIRST_BLOCK + 10)
    const url = chartPath(`&toBlock=${FIRST_BLOCK + 100}`)
    expect((await response(url, chartFixture([item, item]))).trades).toHaveLength(1)
    const conflicting = { ...item, data: (chartSwap(FIRST_BLOCK + 10, 0, Q96 * 2n) as {data: string}).data }
    expect((await dexApi(request(url), chartFixture([item, conflicting]), memoryStore())).status).toBe(502)
  })
  it('keeps raw candles and actual timestamps but nulls human prices when decimals are unavailable', async () => {
    const result = await response(chartPath(`&toBlock=${FIRST_BLOCK + 100}`), chartFixture([chartSwap(FIRST_BLOCK + 10)], { missingDecimals: true }))
    expect(result.priceToken1PerToken0).toBeNull()
    expect(result.priceUnavailableReason).toEqual(expect.any(String))
    expect(result.trades[0].priceToken1PerToken0).toBeNull()
    expect(result.candles[0]).toMatchObject({ open: null, high: null, low: null, close: null, sqrtPriceOpenX96: String(Q96), tradeCount: 1 })
  })
  it('returns empty candles for no swaps and errors for RPC failure, wrong block hashes or invalid timestamps', async () => {
    const url = chartPath(`&toBlock=${FIRST_BLOCK + 100}`)
    const empty = await response(url)
    expect(empty.candles).toEqual([])
    expect(empty.trades).toEqual([])
    for (const options of [{ failedLogs: true }, { invalidTimestamp: FIRST_BLOCK + 10 }]) expect((await dexApi(request(url), chartFixture([chartSwap(FIRST_BLOCK + 10)], options), memoryStore())).status).toBe(502)
    const wrong = await dexApi(request(url), chartFixture([chartSwap(FIRST_BLOCK + 10)], { wrongBlockHash: FIRST_BLOCK + 10 }), memoryStore())
    expect(wrong.status).toBe(409)
    expect(await wrong.json()).toMatchObject({ code: 'CHAIN_REORGANIZED', restartFromBlock: FIRST_BLOCK })
  })
  it('invalidates reorg/expired cursors and rejects parameter substitution and unsupported intervals', async () => {
    const salt = { value: 0 }, source = chartFixture([], { chainSalt: salt }), store = memoryStore(), url = chartPath()
    const first = await response(url, source, store)
    expect((await dexApi(request(`${url}&cursor=${first.nextCursor}`), source, memoryStore())).status).toBe(409)
    expect((await dexApi(request(`${url.replace('1h', '5m')}&cursor=${first.nextCursor}`), source, store)).status).toBe(409)
    salt.value = 1
    const result = await dexApi(request(`${url}&cursor=${first.nextCursor}`), source, store)
    expect(result.status).toBe(409)
    expect(await result.json()).toMatchObject({ code: 'CHAIN_REORGANIZED' })
    for (const path of [url.replace('1h', '2m'), `chart?pool=${pools.v3.address}`, chartPath('&protocol=v4'), chartPath('&fromBlock=0')]) expect((await dexApi(request(path), chartFixture(), memoryStore())).status).toBe(400)
  })
  it('fails explicitly when a cumulative query exceeds the bounded cache trade capacity', async () => {
    const items = Array.from({ length: 6 }, (_pageValue, page) => Array.from({ length: 1000 }, (_tradeValue, index) => chartSwap(FIRST_BLOCK + page * 2000 + 10, index))).flat()
    const source = chartFixture(items, { currentBlock: FIRST_BLOCK + 12000 }), store = memoryStore(), url = chartPath()
    let value = await response(url, source, store)
    for (let count = 0; count < 4; count++) value = await response(`${url}&cursor=${value.nextCursor}`, source, store)
    expect(value.trades).toHaveLength(5000)
    expect(value.queryComplete).toBe(false)
    const rejected = await dexApi(request(`${url}&cursor=${value.nextCursor}`), source, store)
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toEqual({ error: 'Chart range exceeds 5000 trades; choose a narrower block range', code: 'CHART_RANGE_TOO_LARGE' })
  })

})
