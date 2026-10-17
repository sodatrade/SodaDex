import type { ReactElement } from 'react'
import { Button } from '../../components/primitives'
import { EXPLORER_URL } from '../../domain/assets'
import { orderMessages } from '../../i18n/orders'
import { usePreferences } from '../../preferences/context'
import type { LimitOperation } from './useLimitOperation'
export function OrderSubmissionCard({ operation }: { operation: LimitOperation }): ReactElement | null {
  const { locale } = usePreferences(), m = orderMessages(locale), record = operation.submission
  if (!record) return null
  return <section className="order-submission" aria-label={m.local}><h3>{m.local}</h3>
    <p role="status">{operation.result ? `${m.saved} · ${m[operation.result.status]}` : operation.busy ? m.submitting : m.unknown}</p>
    <dl className="order-details"><div><dt>{m.digest}</dt><dd>{record.id}</dd></div><div><dt>{m.maker}</dt><dd>{record.order.maker}</dd></div></dl>
    {operation.result?.reason && <p>{m.reason}: {m[operation.result.reason]}</p>}
    {operation.result?.observation && <p className="order-note">{m.observed}: #{operation.result.observation.blockNumber} · {new Date(operation.result.observation.timestamp * 1000).toLocaleString(locale)}</p>}
    {operation.absent && <p className="order-note">{m.absent}</p>}
    {operation.result?.txHash && <a className="transaction-link" href={`${EXPLORER_URL}/tx/${operation.result.txHash}`} target="_blank" rel="noreferrer">{m.tx}</a>}
    <Button onClick={() => void operation.querySubmission()} disabled={operation.busy || operation.checking}>{operation.checking ? m.loading : m.query}</Button>
    {operation.result && <Button onClick={operation.newOrder} disabled={operation.busy || operation.unresolved}>{m.newOrder}</Button>}
  </section>
}
