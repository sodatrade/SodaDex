import { useState, type ReactElement } from 'react'
import { Button, Surface } from '../components/primitives'
import { shortenAddress } from '../lib/address'
import { rpc } from '../lib/readRpc'
import { NETWORK } from '../network'
import { usePreferences } from '../preferences/context'
import { receiptStatus } from '../trading/receipts'
import type { MiningSubmission } from './journal'
import { miningMessages, type MiningMessageKey } from './messages'

export function MiningHistoryPanel({ entries, onUpdate }: { entries: MiningSubmission[]; onUpdate: (entry: MiningSubmission) => void }): ReactElement {
  const { locale } = usePreferences(), m = miningMessages(locale)
  const [checking, setChecking] = useState<string>(), [error, setError] = useState(false)
  return <Surface className="mining-action-card"><h2>{m.history}</h2><p className="dialog-note">{m.historyNote}</p>
    {!entries.length && <p>{m.noHistory}</p>}
    <ol className="mining-history-list">{[...entries].reverse().map((entry) => <li key={entry.hash}>
      <div><strong>{entry.approval && `${m.approval} · `}{entry.action in m ? m[entry.action as MiningMessageKey] : entry.action}</strong>
        <a href={`${NETWORK.explorerUrl}/tx/${entry.hash}`} target="_blank" rel="noreferrer" title={entry.hash}>{shortenAddress(entry.hash)}</a>
        <small>{shortenAddress(entry.from)}</small></div>
      <span>{m[entry.status === 'pending' ? 'pending' : entry.status === 'success' ? 'success' : 'reverted']}</span>
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
