import type { ReactElement } from 'react'
import { getAsset, type AssetId } from '../domain/assets'
import { usePreferences } from '../preferences/context'
import { AssetIcon, Icon } from './primitives'
export function SwapAmountPanel({
  id,
  pay,
  amount,
  onAmount,
  onSelect,
  balance,
  error,
  disabled,
  hint,
}: {
  id: AssetId
  pay?: boolean
  amount: string
  onAmount?: (value: string) => void
  onSelect: () => void
  balance: string
  error?: boolean
  disabled?: boolean
  hint: string
}): ReactElement {
  const { t } = usePreferences(),
    asset = getAsset(id)
  return (
    <div className={`amount-panel${pay ? '' : ' receive-panel'}${error ? ' has-error' : ''}`}>
      <div className="amount-label">
        {pay ? <label htmlFor="sell-amount">{t('pay')}</label> : <span>{t('receive')}</span>}
        <span>{balance}</span>
      </div>
      <div className="amount-row">
        {pay ? (
          <input
            id="sell-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={amount}
            onChange={(e) => onAmount?.(e.target.value.slice(0, 100))}
            aria-invalid={error}
            aria-describedby={error ? 'amount-error' : undefined}
            disabled={disabled}
          />
        ) : (
          <output title={amount} className="receive-amount" aria-label={t('receiveAmount')}>
            {amount}
          </output>
        )}
        <button
          className="token-selector"
          onClick={onSelect}
          disabled={disabled}
          aria-label={t(pay ? 'choosePay' : 'chooseReceive', { symbol: asset.symbol })}
        >
          <AssetIcon assetId={id} small />
          <strong>{asset.symbol}</strong>
          <Icon name="chevron" size={16} />
        </button>
      </div>
      <span className="amount-hint">{hint}</span>
    </div>
  )
}
