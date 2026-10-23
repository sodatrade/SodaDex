import type { ReactElement } from 'react'
import { Dialog } from '../../components/Dialog'
import { Button } from '../../components/primitives'
import { EXPLORER_URL } from '../../domain/assets'
import { orderMessages } from '../../i18n/orders'
import type { Currency } from '../../liquidity/types'
import { usePreferences } from '../../preferences/context'
import { OrderDetails } from './OrderDetails'
import type { LimitOperation, LimitReview } from './useLimitOperation'
export function OrderReview({ review, operation, currencies, ready, cancel = false, onClose }: {
  review: LimitReview; operation: LimitOperation; currencies: Currency[]; ready: boolean; cancel?: boolean; onClose: () => void
}): ReactElement {
  const { locale, t } = usePreferences(), m = orderMessages(locale), current = operation.current(review)
  return <Dialog title={cancel ? m.cancelReview : m.review} description={cancel ? m.cancelNote : m.reviewNote} onClose={onClose}>
    <OrderDetails order={review.order} currencies={currencies} />
    {!ready && <p className="order-note">{m.notReady}</p>}
    {operation.progress && <p role="status">{t(operation.progress.stage)}</p>}
    {(!current || operation.error) && <p role="alert" className="error-text">{t(!current ? 'tradeIdentityChanged' : operation.error!)}</p>}
    {operation.confirmed && <p role="status">{m.confirmed}</p>}
    {operation.record && <a className="transaction-link" href={`${EXPLORER_URL}/tx/${operation.record.hash}`} target="_blank" rel="noreferrer">{m.tx}</a>}
    {operation.unresolved ? <Button onClick={() => void operation.recheck()} disabled={operation.busy || operation.checking}>{m.receipt}</Button>
      : !operation.confirmed && (cancel || !operation.submission) && <Button appearance="primary" className="order-primary" disabled={!ready || !current || operation.busy}
        onClick={() => void operation.execute(review, cancel)}>{operation.busy ? m.submitting : cancel ? m.confirmCancel : m.confirm}</Button>}
  </Dialog>
}
