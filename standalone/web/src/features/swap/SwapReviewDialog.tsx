import type { ReactElement } from 'react'
import { formatUnits } from 'viem'
import { Dialog } from '../../components/Dialog'
import { Button, Icon } from '../../components/primitives'
import { EXPLORER_URL, shortenAddress } from '../../domain/assets'
import { tradeMessages } from '../../i18n/trade'
import type { Currency } from '../../liquidity/types'
import { usePreferences } from '../../preferences/context'
import { publicSwapsEnabled } from '../../trading/config'
import { CurrencyIcon } from './CurrencyPicker'
import { TradeDetails } from './TradeDetails'
import type { SwapReview, useSwapOperation } from './useSwapOperation'
export function SwapReviewDialog({ review, from, to, current, operation, onConfirm, onClose }: {
  review: SwapReview; from: Currency; to: Currency; current: boolean; operation: ReturnType<typeof useSwapOperation>; onConfirm: () => void; onClose: () => void
}): ReactElement {
  const { locale, t } = usePreferences(), m = tradeMessages(locale)
  const amount = review.kind === 'pool' ? review.quote.amount : review.request.amount
  const output = review.kind === 'pool' ? review.quote.amountOut : amount
  const done = operation.progress?.stage === 'tradeSucceeded' || !!operation.receiptMessage
  const paused = !publicSwapsEnabled()
  return <Dialog title={review.kind === 'wrap' ? m[review.request.direction] : m.review} description={m.test} onClose={onClose}>
    <div className="review-pair"><div><CurrencyIcon currency={from} /><strong>{formatUnits(amount, from.decimals)} {from.symbol}</strong></div>
      <Icon name="arrow" /><div><CurrencyIcon currency={to} /><strong>{formatUnits(output, to.decimals)} {to.symbol}</strong></div></div>
    {review.kind === 'pool' ? <TradeDetails quote={review.quote} /> : <p className="dialog-note">{m.wrapping}</p>}
    <p className="dialog-note">{m.gas}</p>
    {operation.progress && <p role="status" className="trade-status">{t(operation.progress.stage)}</p>}
    {operation.error && <p role="alert" className="error-text">{t(operation.error)}</p>}
    {!current && !done && <p role="alert" className="error-text">{m.stale}</p>}
    {paused && !done && <p role="status">{m.readonly}</p>}
    {operation.record && <a className="transaction-link" href={`${EXPLORER_URL}/tx/${operation.record.hash}`} target="_blank" rel="noreferrer">{m.submitted} {shortenAddress(operation.record.hash)} <Icon name="external" size={14} /></a>}
    {operation.unresolved && !operation.busy ? <Button className="swap-action" onClick={() => void operation.recheck()} disabled={operation.checking}>{m[operation.checking ? 'loading' : 'receipt']}</Button>
      : <Button appearance="primary" className="swap-action" onClick={done ? onClose : onConfirm}
        disabled={!done && (paused || !current || operation.busy || !!operation.error)}>{done ? m.close : operation.busy ? t('waitingConfirmation') : m.confirm}</Button>}
  </Dialog>
}
