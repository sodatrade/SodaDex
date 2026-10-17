import { useState, type ReactElement } from 'react'
import { Button } from '../../components/primitives'
import { EXPLORER_URL } from '../../domain/assets'
import { orderMessages } from '../../i18n/orders'
import { usePreferences } from '../../preferences/context'
import type { Currency } from '../../liquidity/types'
import type { WalletController } from '../../lib/useWallet'
import type { OrderDeployment } from './config'
import { OrderReview } from './OrderReview'
import type { LimitOperation, LimitReview } from './useLimitOperation'
export function OrderSubmissionCard({ operation, wallet, deployment, currencies }: { operation: LimitOperation; wallet: WalletController; deployment?: OrderDeployment; currencies: Currency[] }): ReactElement | null {
  const { locale } = usePreferences(), m = orderMessages(locale), [review, setReview] = useState<LimitReview>(), record = operation.submission
  if (!record) return null
  return <section className="order-submission" aria-label={m.local}><h3>{m.local}</h3>
    <p role="status">{record.recovery ? `${m.chainState}: ${m[record.recovery!.status]}` : operation.result ? `${m.saved} · ${m[operation.result.status]}` : operation.busy ? m.submitting : m.unknown}</p>
    <dl className="order-details"><div><dt>{m.digest}</dt><dd>{record.id}</dd></div><div><dt>{m.maker}</dt><dd>{record.order.maker}</dd></div></dl>
    {operation.result?.reason && <p>{m.reason}: {m[operation.result.reason]}</p>}
    {operation.result?.observation && <p className="order-note">{m.observed}: #{operation.result.observation.blockNumber} · {new Date(operation.result.observation.timestamp * 1000).toLocaleString(locale)}</p>}
    {operation.absent && <p className="order-note">{m.absent}</p>}
    {operation.result?.txHash && <a className="transaction-link" href={`${EXPLORER_URL}/tx/${operation.result.txHash}`} target="_blank" rel="noreferrer">{m.tx}</a>}
    <Button onClick={() => void operation.querySubmission()} disabled={operation.busy || operation.checking}>{operation.checking ? m.loading : m.query}</Button>
    {record.recovery && <p className="order-note">{m.chainState}: {m[record.recovery.status]} · #{record.recovery.blockNumber} · {new Date(record.recovery.timestamp * 1000).toLocaleString(locale)}<br /><span className="order-id">{record.recovery.blockHash}</span></p>}
    <p className="order-note">{m.recoveryNote}</p>
    <Button onClick={() => void operation.queryChain()} disabled={operation.busy || operation.checking}>{m.checkChain}</Button>
    {!operation.chainTerminal && <Button onClick={() => { const identity = wallet.getIdentity(); if (identity && operation.canCancelSubmission) setReview(operation.review(record.order, identity)) }} disabled={!operation.canCancelSubmission || operation.busy || operation.checking || operation.unresolved}>{m.cancelLocal}</Button>}
    {operation.chainTerminal && <Button onClick={() => void operation.newOrder()} disabled={operation.busy || operation.checking || operation.unresolved}>{m.newOrder}</Button>}
    {review && <OrderReview review={review} operation={operation} currencies={currencies} ready={!!deployment} cancel onClose={() => { operation.changed(); setReview(undefined) }} />}
  </section>
}
