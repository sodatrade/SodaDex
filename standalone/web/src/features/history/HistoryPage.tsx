import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactElement } from 'react'
import type { Hex } from 'viem'
import { Button, Icon } from '../../components/primitives'
import { Pagination, usePagination } from '../../components/Pagination'
import { CHAIN_ID, EXPLORER_URL, shortenAddress } from '../../domain/assets'
import { dataMessages } from '../../i18n/data'
import type { WalletController } from '../../lib/useWallet'
import { usePreferences } from '../../preferences/context'
import { DataError, getEvents, mergeEvents, type EventQuery } from '../market/api'
import '../market/data.css'
import { JOURNAL_CHANGED, readTransactions } from './journal'
import { ReceiptLookup } from './ReceiptLookup'

export type HistoryScope = 'all' | 'mine' | 'local'
export function HistoryPage({ wallet, onConnect, initialScope = 'all', scopes = ['all', 'mine', 'local'], embedded = false }: {
  wallet: WalletController; onConnect: () => void; initialScope?: HistoryScope; scopes?: readonly HistoryScope[]; embedded?: boolean
}): ReactElement {
  const { locale } = usePreferences()
  const m = dataMessages(locale)
  const [scope, setScope] = useState<HistoryScope>(scopes.includes(initialScope) ? initialScope : scopes[0] ?? 'all')
  const [, setRevision] = useState(0)
  const [selectedHash, setSelectedHash] = useState<Hex>()
  const account = wallet.session?.chainId === CHAIN_ID ? wallet.session.address : undefined
  const queryClient = useQueryClient()
  useEffect(() => {
    const refresh = (): void => setRevision((v) => v + 1)
    window.addEventListener(JOURNAL_CHANGED, refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener(JOURNAL_CHANGED, refresh); window.removeEventListener('storage', refresh) }
  }, [])
  const events = useInfiniteQuery({
    queryKey: ['dex-events', scope, scope === 'mine' ? account : undefined],
    initialPageParam: {} as EventQuery,
    queryFn: async ({ pageParam }) => {
      const request = { ...pageParam, ...(scope === 'mine' ? { owner: account } : {}) }
      return { request, data: await getEvents(request) }
    },
    getNextPageParam: ({ data, request }) => data.nextCursor
      ? { ...request, cursor: data.nextCursor }
      : data.coverage.nextFromBlock === null ? undefined
        : { ...request, cursor: undefined, fromBlock: data.coverage.nextFromBlock, toBlock: request.toBlock ?? data.asOf.number },
    enabled: scope === 'all' || (scope === 'mine' && !!account), retry: false,
  })
  const restart = events.error instanceof DataError && events.error.code !== 'UNAVAILABLE'
  const rows = restart ? [] : mergeEvents(events.data?.pages.map((p) => p.data) ?? [])
  const last = restart ? undefined : events.data?.pages.at(-1)?.data
  const local = account ? readTransactions(account) : []
  const paginationKey = `${scope}:${account?.toLowerCase() ?? ''}`
  const chainPagination = usePagination(rows, paginationKey)
  const localPagination = usePagination(local, paginationKey)
  return <section className={embedded ? "data-page portfolio-activity" : "content-page data-page"} aria-label={m.history}>
    {!embedded && <div className="page-heading"><span className="eyebrow">ACTIVITY / X LAYER</span>
      <h1 id="history-title">{m.history}</h1><p>{m.historyNote}</p></div>}
    <div className="data-tabs" aria-label={m.history}>
      {scopes.map((s) => <Button key={s} aria-pressed={scope === s} onClick={() => setScope(s)}>{m[s]}</Button>)}
    </div>
    {scope !== 'all' && !account && <Button onClick={wallet.session ? () => void wallet.switchChain() : onConnect}>
      {wallet.session ? m.wrongChain : m.connect}</Button>}
    {scope === 'local' ? <>
      <p className="data-muted">{m.localNote}</p>
      {account && local.length === 0 && <p>{m.localEmpty}</p>}
      <ul className="history-local">{localPagination.items.map((r) => <li key={r.hash}>
        <div className="history-row"><div><strong>{r.kind}</strong><span>{m[r.status]}</span>
          <a href={`${EXPLORER_URL}/tx/${r.hash}`} target="_blank" rel="noreferrer">{shortenAddress(r.hash)} <Icon name="external" size={14} /></a></div>
          <Button onClick={() => setSelectedHash(r.hash)}>{m.check}</Button></div>
        <small>{new Date(r.submittedAt).toLocaleString(locale)}</small>
      </li>)}</ul>
      <Pagination {...localPagination} />
    </> : <>
      {events.isFetching && <p role="status">{m.loading}</p>}
      {events.isError && <p className="error-text" role="alert">{restart ? m.scanRestart : m.unavailable} <Button onClick={() => {
        if (restart) void queryClient.resetQueries({ queryKey: ['dex-events', scope, scope === 'mine' ? account : undefined], exact: true })
        else void events.refetch()
      }}>{m.retry}</Button></p>}
      {last && <p className="data-muted">{m.scanned}: #{events.data?.pages[0]?.data.coverage.fromBlock} – #{last.coverage.toBlock}
        {' · '}{events.hasNextPage ? m.partial : m.complete} · {m.snapshot} #{last.asOf.number}</p>}
      {last && rows.length === 0 && <p>{m.noData}</p>}
      <ol className="history-list" start={chainPagination.start || 1}>{chainPagination.items.map((r) => <li key={r.id}>
        <div className="history-row"><div><strong>{r.event}</strong><span>{r.protocol.toUpperCase()}</span><span className="data-muted">#{r.blockNumber}</span></div>
          <a href={`${EXPLORER_URL}/tx/${r.transactionHash}`} target="_blank" rel="noreferrer">{shortenAddress(r.transactionHash)} <Icon name="external" size={14} /></a></div>
        <details><summary>{m.details}</summary><dl>{Object.entries(r.args).map(([key, value]) =>
          <div key={key} style={{ display: 'contents' }}><dt>{key}</dt><dd>{String(value)}</dd></div>)}
          <dt>Block hash</dt><dd>{r.blockHash}</dd></dl></details>
      </li>)}</ol>
      <Pagination {...chainPagination} />
      {events.hasNextPage && chainPagination.page + 1 === chainPagination.pages && <Button className="data-load-more" onClick={() => void events.fetchNextPage()} disabled={events.isFetching}>{m.more}</Button>}
    </>}
    <ReceiptLookup selectedHash={selectedHash} />
  </section>
}
