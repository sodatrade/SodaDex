import './tradeMarket.css'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { Button, Icon } from '../../components/primitives'
import { EXPLORER_URL, shortenAddress } from '../../domain/assets'
import { tradeMarketMessages } from '../../i18n/tradeMarket'
import { LP_CONTRACTS } from '../../liquidity/config'
import { usePreferences } from '../../preferences/context'
import type { TradeMarketContext } from '../trade/context'
import { CHART_INTERVALS, DataError, getChart, type ChartInterval } from './api'
import { ChartRange } from './ChartRange'
import { chartPool, directionalPrice, displayCandles, scannedVolume } from './marketModel'
import { TradeChart, formatPrice } from './TradeChart'
import { TradeMarketTrades } from './TradeMarketTrades'
interface CursorPage { cursor?: string; anchor?: string }
export function TradeMarketPanel({ context, active = true }: { context?: TradeMarketContext; active?: boolean }): ReactElement {
  const { locale } = usePreferences(), m = tradeMarketMessages(locale), queryClient = useQueryClient()
  const [interval, setInterval] = useState<ChartInterval>('5m'), [mode, setMode] = useState<'line' | 'candles'>('line')
  const [range, setRange] = useState<{ fromBlock: number; toBlock: number }>()
  const pool = context?.activePool
  const queryKey = ['trade-chart', pool?.protocol, pool?.id, interval, range]
  const chart = useInfiniteQuery({ queryKey, initialPageParam: {} as CursorPage, enabled: active && !!pool,
    retry: false, staleTime: Infinity, queryFn: async ({ pageParam }) => {
      const data = await getChart(chartPool(pool!), { interval, ...range, ...(pageParam.cursor ? { cursor: pageParam.cursor } : {}) })
      if (pageParam.anchor && pageParam.anchor !== data.asOf.hash) throw new DataError('CHAIN_REORGANIZED')
      return data
    }, getNextPageParam: (data): CursorPage | undefined => data.nextCursor ? { cursor: data.nextCursor, anchor: data.asOf.hash } : undefined })
  // A background or pagination error must not label the previous snapshot as current.
  const lastPage = chart.data?.pages.at(-1)
  const data = chart.isError || !pool ? undefined : lastPage
  const reverse = context?.zeroForOne === false, unit = context ? `${context.to.symbol} / ${context.from.symbol}` : ''
  const candles = data ? displayCandles(data.candles, reverse) : []
  const volume = data ? scannedVolume(data, !reverse) : undefined
  const currentPrice = data ? directionalPrice(data.priceToken1PerToken0, reverse) : undefined
  const change = candles.length > 1 ? (candles.at(-1)!.close / candles[0].close - 1) * 100 : undefined
  const source = context?.mode === 'quote' ? m.quoteSource : m.pairSource
  const retry = (): void => { void queryClient.resetQueries({ queryKey, exact: true }) }
  const unavailable = !context || context.mode === 'loading' ? m.loading : context.mode === 'wrap' ? m.wrap : context.mode === 'unavailable' ? m.unavailable : m.noPool
  return <section className="trade-market-pane" aria-label={m.market}>
    <section className="trade-market-chart-surface"><div className="trade-market-heading"><div><span className="trade-market-source">{m.source}</span>
      <h2>{context ? `${context.from.symbol} / ${context.to.symbol}` : m.market}</h2><p>{pool ? `${source} · ${pool.protocol.toUpperCase()} · ${pool.fee / 10000}%` : 'X Layer · 196'}</p></div>
      <Button appearance="icon" aria-label={m.retry} onClick={retry} disabled={!pool || chart.isFetching}><Icon name="refresh" size={17} /></Button></div>
      <div className="trade-market-price"><span>{m.title}</span><strong>{data ? `1 ${context!.from.symbol} = ${formatPrice(currentPrice, locale)} ${context!.to.symbol}` : '—'}</strong>
        {data && <small>{m.snapshot} #{data.asOf.number} · {new Date(data.asOf.timestamp * 1000).toLocaleString(locale)}</small>}</div>
      <div className="trade-chart-toolbar"><div role="group" aria-label={m.interval}>{CHART_INTERVALS.map((value) => <button key={value} aria-pressed={interval === value} onClick={() => setInterval(value)}>{value}</button>)}</div>
        <div role="group" aria-label={m.chartView}>{(['line', 'candles'] as const).map((value) => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{m[value]}</button>)}</div></div>
      {!pool ? <p className="trade-market-empty" role="status">{unavailable}</p> : chart.isPending ? <p className="trade-market-empty" role="status">{m.loading}</p>
        : chart.isError ? <div className="trade-market-empty" role="alert"><p>{chart.error instanceof DataError && chart.error.code === 'CHART_RANGE_TOO_LARGE' ? m.rangeLimit : chart.error instanceof DataError && chart.error.code !== 'UNAVAILABLE' ? m.stale : m.unavailable}</p><Button onClick={retry}>{m.retry}</Button>
            {lastPage && <small>{m.range}: #{lastPage.query.fromBlock} – #{lastPage.query.toBlock}<br />{m.lastScan}: #{lastPage.coverage.fromBlock} – #{lastPage.coverage.toBlock}</small>}</div>
          : data && (!data.candles.length ? <p className="trade-market-empty">{m.noTrades}</p> : !candles.length ? <p className="trade-market-empty">{m.noPrices}</p> : <TradeChart candles={candles} mode={mode} unit={unit} />)}
      {data && <><div className="trade-market-statistics"><div><span>{m.observed}</span><strong>{data.trades.length}</strong></div>
        <div><span>{m.volume}</span><strong title={volume?.from}>{volume?.from ?? '—'} {context!.from.symbol}</strong><small title={volume?.to}>{volume?.to ?? '—'} {context!.to.symbol}</small></div>
        <div><span>{m.change}</span><strong>{change === undefined ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}</strong></div></div>
        <p className="trade-market-coverage" role="status">{data.queryComplete ? m.complete : m.partial} · {m.scanned} #{data.coverage.fromBlock} – #{data.coverage.toBlock} / #{data.query.toBlock}</p>
        {!data.queryComplete && <Button className="trade-market-load" onClick={() => void chart.fetchNextPage()} disabled={chart.isFetching}>{chart.isFetching ? m.loading : m.more}</Button>}
        <a className="trade-market-pool-link" href={`${EXPLORER_URL}/address/${pool!.address ?? LP_CONTRACTS.poolManager}`} target="_blank" rel="noreferrer" title={pool!.id}>{m.pool}: {shortenAddress(pool!.id)} <Icon name="external" size={12} /></a></>}
      <ChartRange onApply={setRange} /><p className="trade-market-muted">{m.currentNote} {m.note}</p>
    </section>
    {data && context && <TradeMarketTrades data={data} context={context} />}
  </section>
}
