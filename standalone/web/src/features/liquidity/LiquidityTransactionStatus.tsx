import type { ReactElement } from 'react'
import { Button, Icon } from '../../components/primitives'
import { EXPLORER_URL, shortenAddress } from '../../domain/assets'
import type { LiquidityText } from '../../i18n/liquidity'
import { stageMessage } from './presentation'
import type { useLiquidityOperation } from './useLiquidityOperation'
export function LiquidityTransactionStatus({
  operation,
  l,
}: {
  operation: ReturnType<typeof useLiquidityOperation>
  l: LiquidityText
}): ReactElement | null {
  if (!operation.record && !operation.progress && !operation.error) return null
  return (
    <section className="lp-transaction" aria-label={l('recent')}>
      {operation.progress && <p role="status">{l(stageMessage[operation.progress.stage])}</p>}
      {operation.error && (
        <p className="error-text" role="alert">
          {l(operation.error)}
        </p>
      )}
      {operation.record && (
        <>
          <a href={`${EXPLORER_URL}/tx/${operation.record.hash}`} target="_blank" rel="noreferrer">
            {l('recent')} · {shortenAddress(operation.record.hash)}
            <Icon name="external" size={14} />
          </a>
          <p className="lp-muted">
            {shortenAddress(operation.record.from)} · {operation.record.protocol.toUpperCase()}
          </p>
          {operation.recovered && <p className="lp-muted">{l('recovered')}</p>}
          {(operation.record.status === 'pending' || operation.receiptMessage) && (
            <p role="status">{l(operation.receiptMessage ?? 'pending')}</p>
          )}
          {operation.record.status === 'pending' && (
            <Button disabled={operation.checking || operation.executing} onClick={() => void operation.recheck()}>
              {l(operation.checking ? 'loading' : 'checkReceipt')}
            </Button>
          )}
        </>
      )}
      {operation.storageFailed && <p className="lp-muted">{l('storageUnavailable')}</p>}
    </section>
  )
}
