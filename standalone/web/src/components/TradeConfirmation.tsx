import type { ReactElement } from 'react'
import { formatUnits } from 'viem'
import { CHAIN_ID, EXPLORER_URL, getAsset, shortenAddress } from '../domain/assets'
import { usePreferences } from '../preferences/context'
import { CONTRACTS } from '../trading/config'
import type { Quote, TradeIdentity } from '../trading/types'
import type { useTrade } from '../trading/useTrade'
import { Dialog } from './Dialog'
import { AssetIcon, Button, Icon } from './primitives'

export function TradeConfirmation({
  quote,
  identity,
  trade,
  current,
  onConfirm,
  onClose,
}: {
  quote: Quote
  identity: TradeIdentity
  trade: ReturnType<typeof useTrade>
  current: boolean
  onConfirm: () => void
  onClose: () => void
}): ReactElement {
  const { t } = usePreferences()
  const from = getAsset(quote.from),
    to = getAsset(quote.to)
  const done = trade.progress?.stage === 'tradeSucceeded'
  return (
    <Dialog title={t('reviewSwap')} description={t('tradeNotice')} onClose={onClose}>
      <div className="review-pair">
        <div>
          <AssetIcon assetId={from.id} small />
          <strong>
            {formatUnits(quote.amount, from.decimals)} {from.symbol}
          </strong>
        </div>
        <Icon name="arrow" />
        <div>
          <AssetIcon assetId={to.id} small />
          <strong>
            {formatUnits(quote.amountOut, to.decimals)} {to.symbol}
          </strong>
        </div>
      </div>
      <dl className="review-details">
        <div>
          <dt>{t('minimumReceived')}</dt>
          <dd>
            {formatUnits(quote.minimumOut, to.decimals)} {to.symbol}
          </dd>
        </div>
        <div>
          <dt>{t('slippageTolerance')}</dt>
          <dd>0.5%</dd>
        </div>
        <div>
          <dt>{t('protocolPreference')}</dt>
          <dd>
            {quote.protocol.toUpperCase()} · {quote.protocol === 'v3' ? '0.01%' : '0%'}
          </dd>
        </div>
        <div>
          <dt>{t('platformProtocolFee')}</dt>
          <dd>0%</dd>
        </div>
        <div>
          <dt>{t('networkLabel')}</dt>
          <dd>X Layer · {CHAIN_ID}</dd>
        </div>
        <div>
          <dt>{t('recipient')}</dt>
          <dd>
            <a href={`${EXPLORER_URL}/address/${identity.address}`} target="_blank" rel="noreferrer">
              {shortenAddress(identity.address)}
            </a>
          </dd>
        </div>
        <div>
          <dt>{t('swapRouter')}</dt>
          <dd>
            <a href={`${EXPLORER_URL}/address/${CONTRACTS.router}`} target="_blank" rel="noreferrer">
              {shortenAddress(CONTRACTS.router)}
            </a>
          </dd>
        </div>
      </dl>
      <p className="dialog-note">{t(quote.from === 'usdt0' ? 'boundedApprovalNote' : 'nativeRouteNote')}</p>
      <p className="dialog-note">{t('deadlineNote')}</p>
      {trade.progress && (
        <p className="trade-status" role="status">
          {t(trade.progress.stage)}
        </p>
      )}
      {trade.progress?.hash && (
        <a
          className="transaction-link"
          href={`${EXPLORER_URL}/tx/${trade.progress.hash}`}
          target="_blank"
          rel="noreferrer"
        >
          {t('viewTransaction')} <Icon name="external" size={14} />
        </a>
      )}
      {(trade.error || !current) && !done && (
        <p className="error-text" role="alert">
          {t(trade.error ?? 'tradeIdentityChanged')}
        </p>
      )}
      {trade.unresolved && !trade.busy ? (
        <Button className="swap-action" onClick={() => void trade.recheck()} disabled={trade.checking}>
          {t(trade.checking ? 'reading' : 'checkReceipt')}
        </Button>
      ) : (
        <Button
          appearance="primary"
          className="swap-action"
          onClick={done ? onClose : onConfirm}
          disabled={!done && (!current || trade.busy || !!trade.error)}
        >
          {t(done ? 'closeDialog' : trade.busy ? 'waitingConfirmation' : 'confirmSwap')}
        </Button>
      )}
    </Dialog>
  )
}
