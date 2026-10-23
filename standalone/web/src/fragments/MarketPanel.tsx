import { deploymentKey, shareSymbol, type FragmentDeployment } from './config'
import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatEther } from 'viem'
import { Button } from '../components/primitives'
import type { Messages } from './messages'
import { NETWORK } from '../network'
import { ExpiredMarketPage, readMarket, marketNumber, tradePrice, tradeAmount } from './market'
export function MarketPanel({ deployment: d, m }: { deployment: FragmentDeployment; m: Messages }): ReactElement {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), [page, setPage] = useState(0)
  const market = useQuery({ queryKey: ['fragment-market', deploymentKey(d), cursors[page]],
    queryFn: ({ signal }) => readMarket(d, cursors[page], signal), refetchInterval: page === 0 ? 15000 : false, staleTime: 10000, retry: false })
  const data = market.data, chart = data?.chart ?? [], points = chart.map(tradePrice)
  const lo = Math.min(...points), hi = Math.max(...points), range = hi - lo || hi * 0.01 || 1
  const start = chart[0]?.timestamp ?? 0, end = chart.at(-1)?.timestamp ?? start
  const path = points.map((v, i) => `${i ? 'L' : 'M'}${20 + (end > start ? (chart[i].timestamp - start) / (end - start) : i / Math.max(1, points.length - 1)) * 600},${180 - (v - lo) * 140 / range}`).join(' ')
  const reset = (): void => { setPage(0); setCursors([undefined]); void market.refetch() }
  return <section className="fragment-card fragment-market">
    <div className="fragment-market-title"><h2>{m.price}</h2><span className="fragment-muted">OKB / {shareSymbol(d)}</span></div>
    <div className="fragment-price-value">{points.length ? marketNumber(points.at(-1)!) : '—'} <small>OKB</small></div>
    <p className="fragment-muted fragment-chart-caption">{m.chartHint.replace('{symbol}', shareSymbol(d))}</p>
    {market.isError && <div role="alert" className="fragment-market-status">{market.error instanceof ExpiredMarketPage ? m.pageExpired : m.marketError} <Button onClick={reset}>{m.retry}</Button></div>}
    {market.isPending && <div className="fragment-chart-empty" role="status">{m.loading}</div>}
    {!market.isPending && (points.length > 0 ? <>
      <svg viewBox="0 0 640 220" role="img" aria-label={m.price}><defs><linearGradient id="fragment-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--accent)" stopOpacity="0.14" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
        {[40,110,180].map(y => <line key={y} x1="20" x2="620" y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 6" />)}
        <path d={`${path} L${points.length === 1 ? 20 : 620},200 L20,200 Z`} fill="url(#fragment-fill)" /><path d={path} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
        {points.length === 1 && <circle cx="20" cy="180" r="4" fill="var(--accent)" />}
        <text x="620" y="28" textAnchor="end" fill="var(--muted)" fontSize="11">{marketNumber(hi)}</text><text x="620" y="216" textAnchor="end" fill="var(--muted)" fontSize="11">{marketNumber(lo)}</text>
      </svg><div className="fragment-chart-times"><time>{new Date(start * 1000).toLocaleString()}</time><time>{new Date(end * 1000).toLocaleString()}</time></div>
    </> : <div className="fragment-chart-empty">{data?.index.syncing ? m.indexSyncing : m.noChart}</div>)}
    {data && <p className="fragment-index-state" role="status">{data.index.lastError ? m.indexDelayed : data.index.syncing ? m.indexSyncing : m.indexReady}{data.asOf && <> · {new Date(data.asOf.timestamp * 1000).toLocaleTimeString()}</>}</p>}
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
