import { useQuery } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { formatUnits } from 'viem'
import type { MiningProductDeployment } from '../../../mining-products'
import { MINING_MARKET_INTERVALS, type MiningMarketInterval } from '../../../mining-market'
import { Button, Icon } from '../components/primitives'
import { TradeChart, formatPrice } from '../features/market/TradeChart'
import { tradeMarketMessages } from '../i18n/tradeMarket'
import { indexMessages } from '../i18n/indexing'
import { usePreferences } from '../preferences/context'
import { NETWORK } from '../network'
import { shortenAddress } from '../lib/address'
import { loadMiningMarket } from './marketApi'
import { miningMarketMessages } from './marketMessages'
import { MiningIndexError } from './indexApi'
import '../features/market/tradeMarket.css'
import './market.css'

export function MiningMarketPanel({ deployment, token, symbol }: { deployment: MiningProductDeployment; token: string; symbol: string }): ReactElement {
  const { locale } = usePreferences(), m = miningMarketMessages(locale), common = indexMessages(locale), chart = tradeMarketMessages(locale)
  const [interval, setInterval] = useState<MiningMarketInterval>('5m'), [mode, setMode] = useState<'line' | 'candles'>('line')
  const [view, setView] = useState<'market' | 'activity'>('market'), [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), [page, setPage] = useState(0)
  const result = useQuery({ queryKey: ['mining-market', deployment.version, token, interval, cursors[page]],
    queryFn: ({ signal }) => loadMiningMarket(deployment, token, interval, cursors[page], signal), retry: false, staleTime: 30_000,
    refetchInterval: page === 0 ? 30_000 : false, refetchOnWindowFocus: page === 0 })
  const data = result.isError ? undefined : result.data
  const reset = (): void => { setPage(0); setCursors([undefined]) }
  const candles = data?.candles.map(c => ({ time: c.time, end: c.time + MINING_MARKET_INTERVALS[interval], open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), trades: c.trades })) ?? []
  return <section className="trade-market-chart-surface mining-market" aria-label={`${m.title} · ${symbol}`}>
    <header className="trade-market-heading"><div><h2>{symbol} / TEST-FAB</h2><p>{m.title}</p></div>
      <Button appearance="icon" aria-label={`${common.retry} · ${m.title}`} disabled={result.isFetching} onClick={() => { reset(); if (page === 0) void result.refetch() }}><Icon name="refresh" size={16} /></Button></header>
    <div className="mining-action-switch mining-market-tabs" role="group" aria-label={m.title}>{(['market', 'activity'] as const).map(v => <Button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{m[v]}</Button>)}</div>
    {result.isPending && <p role="status">{common.loading}</p>}
    {result.isError && <p role="alert">{result.error instanceof MiningIndexError && result.error.restart ? common.restart : common.unavailable}</p>}
    {data && <>
      {view === 'market' ? <>{candles.length ? <TradeChart candles={candles} mode={mode} unit={`TEST-FAB / ${symbol}`} /> : <p className="trade-market-empty">{m.empty}</p>}
        <div className="trade-chart-toolbar"><div role="group" aria-label={chart.interval}>{(Object.keys(MINING_MARKET_INTERVALS) as MiningMarketInterval[]).map(i => <button key={i} aria-pressed={interval === i} onClick={() => { reset(); setInterval(i) }}>{i}</button>)}</div>
          <div role="group" aria-label={chart.chartView}>{(['line', 'candles'] as const).map(v => <button key={v} aria-pressed={mode === v} onClick={() => setMode(v)}>{chart[v]}</button>)}</div></div></>
        : <><div className="mining-market-table"><table><thead><tr><th>{m.time}</th><th>{m.source}</th><th>{m.amount}</th><th>{m.price}</th><th>{m.transaction}</th></tr></thead><tbody>{data.trades.map(t => <tr key={t.id}>
          <td>{new Date(t.timestamp * 1000).toLocaleString(locale)}</td><td>{m[t.source]} · {t.buy ? m.buy : m.sell}</td>
          <td title={formatUnits(BigInt(t.assetRaw), 18)}>{formatPrice(Number(formatUnits(BigInt(t.assetRaw), 18)), locale)} {symbol}</td>
          <td>{formatPrice(Number(t.price), locale)} TEST-FAB</td><td><a href={`${NETWORK.explorerUrl}/tx/${t.transactionHash}`} target="_blank" rel="noreferrer">{shortenAddress(t.transactionHash)} <Icon name="external" size={12} /></a></td>
        </tr>)}</tbody></table></div>{!data.trades.length && <p>{m.empty}</p>}
          <nav className="list-pagination" aria-label={m.history}><span>{common.page} {page + 1} · {data.total}</span><div>
            <Button disabled={page === 0 || result.isFetching} onClick={() => setPage(page - 1)}>{common.previous}</Button>
            <Button disabled={!data.nextCursor || result.isFetching} onClick={() => { if (data.nextCursor) { setCursors([...cursors.slice(0, page + 1), data.nextCursor]); setPage(page + 1) } }}>{common.next}</Button>
          </div></nav></>}
      <p className="mining-market-status" role="status">{data.index.lastError ? common.lag : data.index.syncing ? common.syncing : common.synced} · {common.through} #{data.index.indexedThrough}{data.asOf && <> · {new Date(data.asOf.timestamp * 1000).toLocaleString(locale)}</>}</p>
      {data.historyLimited && <p>{m.limited}</p>}
    </>}
    <p className="mining-market-note">{m.note}</p>
  </section>
}
