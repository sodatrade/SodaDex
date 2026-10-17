import type { ReactElement } from 'react'
import type { Currency } from '../../liquidity/types'
import { Icon } from '../../components/primitives'
import { usePreferences } from '../../preferences/context'
import { tradeMessages } from '../../i18n/trade'
import { CurrencyIcon } from './CurrencyPicker'
export function AmountPanel({ currency, pay, amount, balance, hint, disabled, error, estimated, onAmount, onSelect, onMax }: {
  currency: Currency; pay?: boolean; amount: string; balance: string; hint?: string; disabled: boolean; error?: boolean; estimated?: boolean;
  onAmount?: (value: string) => void; onSelect: () => void; onMax?: () => void
}): ReactElement {
  const { t, locale } = usePreferences(), m = tradeMessages(locale)
  const id = pay ? 'swap-sell-amount' : 'swap-receive-amount'
  return <div className={`amount-panel${pay ? '' : ' receive-panel'}${error ? ' has-error' : ''}`}>
    <div className="amount-label"><span><label htmlFor={id}>{pay ? m.pay : m.receive}</label>{estimated && <span className="swap-estimate"> · {m.estimated}</span>}</span>
      <span>{balance}{onMax && <button className="text-button swap-max" onClick={onMax} disabled={disabled}>{m.max}</button>}</span></div>
    <div className="amount-row"><input id={id} inputMode="decimal" autoComplete="off" placeholder="0" value={amount}
      onChange={(e) => onAmount?.(e.target.value.slice(0, 100))} aria-invalid={error} aria-describedby={error ? 'swap-amount-error' : undefined} disabled={disabled} />
      <button className="token-selector" onClick={onSelect} disabled={disabled} aria-label={t(pay ? 'choosePay' : 'chooseReceive', { symbol: currency.symbol })}>
        <CurrencyIcon currency={currency} /><strong>{currency.symbol}</strong><Icon name="chevron" size={16} /></button></div>
    {hint && <span className="amount-hint">{hint}</span>}
  </div>
}
