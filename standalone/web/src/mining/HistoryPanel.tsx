import { useState, type ReactElement } from 'react'
import { Button, Icon, Surface } from '../components/primitives'
import { shortenAddress } from '../lib/address'
import { rpc } from '../lib/readRpc'
import { NETWORK } from '../network'
import { usePreferences } from '../preferences/context'
import { receiptStatus } from '../trading/receipts'
import type { MiningSubmission } from './journal'
import { miningMessages, type MiningMessageKey } from './messages'

function SubmissionTime({ at, locale }: { at: number; locale: string }): ReactElement {
  const date = new Date(at)
  return Number.isFinite(date.getTime()) ? <time dateTime={date.toISOString()}>{date.toLocaleString(locale)}</time> : <span>—</span>
}

export function MiningHistoryPanel({ entries, account, onUpdate }: { account?: string; entries: MiningSubmission[]; onUpdate: (entry: MiningSubmission) => void }): ReactElement {
  const { locale } = usePreferences(), m = miningMessages(locale)
  const [scope, setScope] = useState<'all' | 'wallet'>('all')
  const visible = scope === 'wallet' && account ? entries.filter((entry) => entry.from.toLowerCase() === account.toLowerCase()) : entries
  const [checking, setChecking] = useState<string>(), [error, setError] = useState(false)
  return <Surface className="mining-action-card mining-history"><header className="mining-history-heading"><h2>{m.history}<span>{visible.length}</span></h2>
    {account && <div className="mining-action-switch" role="group" aria-label={m.history}>
      <Button appearance="ghost" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>{m.allWallets}</Button>
      <Button appearance="ghost" aria-pressed={scope === 'wallet'} onClick={() => setScope('wallet')}>{m.currentWallet}</Button>
    </div>}</header><p className="dialog-note">{m.historyNote}</p>
    {!visible.length && <p className="mining-empty"><Icon name="layers" size={28} />{m.noHistory}</p>}
    <ol className="mining-history-list">{[...visible].reverse().map((entry) => <li key={entry.hash}>
      <div><strong>{entry.approval && `${m.approval} · `}{entry.action in m ? m[entry.action as MiningMessageKey] : entry.action}</strong>
        <a href={`${NETWORK.explorerUrl}/tx/${entry.hash}`} target="_blank" rel="noreferrer" title={entry.hash}>{shortenAddress(entry.hash)}</a>
        <small><SubmissionTime at={entry.at} locale={locale} /> · {shortenAddress(entry.from)}</small></div>
      <span className={`mining-status-badge ${entry.status}`}>{m[entry.status === 'pending' ? 'pending' : entry.status === 'success' ? 'success' : 'reverted']}</span>
      {entry.status === 'pending' && <Button disabled={!!checking} onClick={() => {
        setChecking(entry.hash); setError(false)
        void receiptStatus(rpc, entry.hash, entry.from, entry.to).then((status) => { if (status === 'success') onUpdate({ ...entry, status }) })
          .catch((cause: unknown) => {
            if (cause instanceof Error && cause.message === 'tradeReverted') onUpdate({ ...entry, status: 'reverted' })
            else setError(true)
          }).finally(() => setChecking(undefined))
      }}>{m.receipt}</Button>}
    </li>)}</ol>
    {error && <p role="alert">{m.unavailable}</p>}
  </Surface>
}
