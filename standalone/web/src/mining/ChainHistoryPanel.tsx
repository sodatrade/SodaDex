import { useQuery } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import type { MiningProductDeployment } from '../../../mining-products'
import { Button, Icon, Surface } from '../components/primitives'
import { shortenAddress } from '../lib/address'
import { NETWORK } from '../network'
import { usePreferences } from '../preferences/context'
import { MiningHistoryPanel } from './HistoryPanel'
import { indexEventName, indexMessages } from '../i18n/indexing'
import { loadMiningHistory, MiningIndexError } from './indexApi'
import type { MiningSubmission } from './journal'
import { miningMessages } from './messages'
import './chain-history.css'

function ChainHistory({ deployment, account }: { deployment: MiningProductDeployment; account?: string }): ReactElement {
  const { locale } = usePreferences(), m = indexMessages(locale), common = miningMessages(locale)
  const [mine, setMine] = useState(false)
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [page, setPage] = useState(0)
  const cursor = cursors[page]
  const events = useQuery({ queryKey: ['mining-chain-history', deployment.version, mine ? account : undefined, cursor],
    queryFn: ({ signal }) => loadMiningHistory(deployment, { ...(mine && account ? { owner: account } : {}), ...(cursor ? { cursor } : {}) }, signal),
    enabled: !mine || !!account, retry: false, staleTime: 15_000,
    refetchInterval: (query) => page === 0 ? query.state.data?.index.syncing || query.state.data?.index.lastError ? 5_000 : 30_000 : false,
    refetchOnWindowFocus: page === 0 })
  const result = events.data
  const restart = events.error instanceof MiningIndexError && events.error.restart
  const reset = (): void => { setPage(0); setCursors([undefined]) }
  return <Surface className="mining-action-card mining-history mining-chain-history">
    <header className="mining-history-heading"><h2>{m.chain}</h2><div className="mining-action-switch" role="group" aria-label={common.history}>
      <Button aria-pressed={!mine} onClick={() => { setMine(false); reset() }}>{m.all}</Button>
      <Button aria-pressed={mine} disabled={!account} onClick={() => { setMine(true); reset() }}>{common.currentWallet}</Button>
    </div></header>
    <p className="dialog-note">{m.note}</p>
    <div className="mining-index-status"><span role="status">{result && <>
      {result.index.lastError ? m.lag : result.index.syncing ? m.syncing : m.synced}
      {' · '}{m.through} #{result.index.indexedThrough}
      {result.index.head && <> / #{result.index.head.number}</>}
    </>}</span><Button disabled={events.isFetching} onClick={() => { reset(); if (page === 0) void events.refetch() }}><Icon name="refresh" size={14} />{m.retry}</Button></div>
    {events.isFetching && <p role="status">{m.loading}</p>}
    {events.isError && <p role="alert">{restart ? m.restart : m.unavailable}</p>}
    {result && !result.events.length && <p className="mining-empty">{m.empty}</p>}
    {!restart && <ol className="mining-history-list">{result?.events.map((row) => <li key={row.id}>
      <div><strong>{indexEventName(row.event, locale)}</strong><a href={`${NETWORK.explorerUrl}/tx/${row.transactionHash}`} target="_blank" rel="noreferrer" title={row.transactionHash}>
        {shortenAddress(row.transactionHash)} <Icon name="external" size={13} /></a>
      <small><time dateTime={new Date(row.timestamp * 1000).toISOString()}>{new Date(row.timestamp * 1000).toLocaleString(locale)}</time> · #{row.blockNumber}</small>
      <details><summary>{m.details}</summary><dl className="review-details">{Object.entries(row.args).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{String(value)}</dd></div>)}</dl></details></div>
    </li>)}</ol>}
    {(page > 0 || result?.nextCursor) && <nav className="list-pagination" aria-label={common.history}>
      <span aria-live="polite">{m.page} {page + 1}</span><div>
        <Button disabled={page === 0 || events.isFetching || restart} onClick={() => setPage(page - 1)}>{m.previous}</Button>
        <Button disabled={!result?.nextCursor || events.isFetching || restart} onClick={() => {
          if (!result?.nextCursor) return
          setCursors((previous) => [...previous.slice(0, page + 1), result.nextCursor!]); setPage(page + 1)
        }}>{m.next}</Button>
      </div></nav>}
  </Surface>
}

export function MiningHistoryWorkspace(props: { deployment: MiningProductDeployment; account?: string; entries: MiningSubmission[]; initialView?: 'chain' | 'local'; onUpdate: (entry: MiningSubmission) => void }): ReactElement {
  const { locale } = usePreferences(), m = indexMessages(locale)
  const [view, setView] = useState<'chain' | 'local'>(props.initialView ?? 'chain')
  return <div><div className="mining-history-source mining-action-switch" role="group" aria-label={miningMessages(locale).history}>
    <Button aria-pressed={view === 'chain'} onClick={() => setView('chain')}>{m.chain}</Button>
    <Button aria-pressed={view === 'local'} onClick={() => setView('local')}>{m.local}</Button>
  </div>{view === 'chain' ? <ChainHistory key={`${props.deployment.version}:${props.account?.toLowerCase() ?? ''}`} deployment={props.deployment} account={props.account} />
    : <MiningHistoryPanel entries={props.entries} account={props.account} onUpdate={props.onUpdate} />}</div>
}
