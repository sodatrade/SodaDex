import { deploymentKey, shareSymbol, type FragmentDeployment } from './config'
import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatEther } from 'viem'
import { Button } from '../components/primitives'
import type { Messages } from './messages'
import { NETWORK } from '../network'
import { PriceChart } from './PriceChart'
import { RECENT_CHART_TRADES } from './chartWindow'
import { ExpiredMarketPage, readMarket, marketNumber, tradePrice, tradeAmount } from './market'
export function MarketPanel({ deployment: d, m }: { deployment: FragmentDeployment; m: Messages }): ReactElement {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), [page, setPage] = useState(0)
  const latest = useQuery({ queryKey: ['fragment-market', deploymentKey(d), undefined],
    queryFn: ({ signal }) => readMarket(d, undefined, signal), refetchInterval: 15000, staleTime: 10000, retry: false })
  const market = useQuery({ queryKey: ['fragment-market', deploymentKey(d), cursors[page]],
    queryFn: ({ signal }) => readMarket(d, cursors[page], signal), enabled: page > 0, staleTime: 10000, retry: false, placeholderData: previous => previous?.pool.toLowerCase() === d.pool.toLowerCase() ? previous : undefined })
  const data = market.data, chart = latest.data?.chart ?? [], points = chart.map(tradePrice)
  const reset = (): void => { setPage(0); setCursors([undefined]); void latest.refetch() }
  return <section className="fragment-card fragment-market">
    <div className="fragment-market-title"><h2>{m.price}</h2><span className="fragment-muted">OKB / {shareSymbol(d)}</span></div>
    <div className="fragment-price-value">{points.length ? marketNumber(points.at(-1)!) : '—'} <small>OKB</small></div>
    <p className="fragment-muted fragment-chart-caption">{m.chartHint.replace('{symbol}', shareSymbol(d)).replace('{count}', String(Math.min(RECENT_CHART_TRADES, chart.length)))}</p>
    {(market.isError || latest.isError) && <div role="alert" className="fragment-market-status">{market.error instanceof ExpiredMarketPage ? m.pageExpired : m.marketError} <Button onClick={reset}>{m.retry}</Button></div>}
    {latest.isPending && <div className="fragment-chart-empty" role="status">{m.loading}</div>}
    {!latest.isPending && (points.length > 0 ? <PriceChart key={deploymentKey(d)} trades={chart} symbol={shareSymbol(d)} m={m} />
      : <div className="fragment-chart-empty">{latest.data?.index.syncing ? m.indexSyncing : m.noChart}</div>)}
    {latest.data && <p className="fragment-index-state" role="status">{latest.data.index.lastError ? m.indexDelayed : latest.data.index.syncing ? m.indexSyncing : m.indexReady}{latest.data.asOf && <> · {new Date(latest.data.asOf.timestamp * 1000).toLocaleTimeString()}</>}</p>}
    <div className="fragment-history-heading"><h2>{m.history}</h2><span className="fragment-muted">{m.pageSize}</span></div>
    <div className="fragment-table"><table><thead><tr><th>{m.pay}</th><th>{m.received}</th><th>Tx / {m.time}</th></tr></thead><tbody>{data?.trades.map(t => <tr key={t.id}>
      <td title={formatEther(BigInt(t.input))}>{tradeAmount(t.input)} <small>{t.shareIn ? shareSymbol(d) : 'OKB'}</small></td>
      <td title={formatEther(BigInt(t.output))}>{tradeAmount(t.output)} <small>{t.shareIn ? 'OKB' : shareSymbol(d)}</small></td>
      <td><a target="_blank" rel="noreferrer" aria-label={`${m.explorer} ${t.transactionHash}`} href={`${NETWORK.explorerUrl}/tx/${t.transactionHash}`}>{t.transactionHash.slice(0, 6)}… ↗</a><time className="fragment-trade-time" title={new Date(t.timestamp * 1000).toLocaleString()}>{new Date(t.timestamp * 1000).toLocaleTimeString()}</time></td>
    </tr>)}</tbody></table></div>
    {data?.trades.length === 0 && !data.index.syncing && <p>{m.empty}</p>}
    <div className="fragment-pagination"><Button disabled={page === 0 || market.isFetching} onClick={() => setPage(page - 1)}>{m.previous}</Button><span>{page + 1}</span><Button disabled={!data?.nextCursor || market.isFetching} onClick={() => { setCursors([...cursors.slice(0, page + 1), data!.nextCursor!]); setPage(page + 1) }}>{m.next}</Button></div>
  </section>
}
