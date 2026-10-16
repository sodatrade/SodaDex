import { useEffect, useRef, type ReactElement } from 'react'
import { formatUnits } from 'viem'
import { Button, Icon } from '../../components/primitives'
import { formatBalance } from '../../domain/amount'
import { EXPLORER_URL, shortenAddress, STABLE_ADDRESS, WOKB_ADDRESS } from '../../domain/assets'
import { workspaceMessages } from '../../i18n/workspace'
import { CurrencyLabel } from '../liquidity/CurrencyLabel'
import { usePreferences } from '../../preferences/context'
import type { AssetSelection } from '../../components/AssetPage'
import type { PortfolioToken } from './usePortfolioTokens'
export function BalanceTable({ tokens, onSend, selected }: { tokens: PortfolioToken[]; onSend: (token: PortfolioToken) => void; selected?: AssetSelection }): ReactElement {
  const { locale } = usePreferences(), m = workspaceMessages(locale)
  const focused = useRef<AssetSelection | undefined>(undefined)
  useEffect(() => {
    if (!selected || focused.current === selected) return
    const row = document.getElementById(`portfolio-asset-${selected.id}`)
    if (row) { row.focus(); focused.current = selected }
  }, [selected, tokens])
  const id = (token: PortfolioToken): string | undefined => token.currency.native ? 'okb' : token.currency.address.toLowerCase() === WOKB_ADDRESS.toLowerCase() ? 'wokb' : token.currency.address.toLowerCase() === STABLE_ADDRESS.toLowerCase() ? 'usdt0' : undefined
  return <div className="portfolio-token-table">
    <div className="portfolio-token-head"><span>{m.token}</span><span>{m.balance}</span><span /></div>
    {tokens.map(({ currency, balance }) => <div className={`portfolio-token-row${selected?.id === id({ currency, balance }) ? ' is-selected' : ''}`} key={currency.address}
      id={id({ currency, balance }) ? `portfolio-asset-${id({ currency, balance })}` : undefined} tabIndex={selected?.id === id({ currency, balance }) ? -1 : undefined} role="group" aria-label={currency.symbol}>
      <div><CurrencyLabel currency={currency} /><small>{currency.name}</small>
        {!currency.native && <a href={`${EXPLORER_URL}/token/${currency.address}`} target="_blank" rel="noreferrer">
          {shortenAddress(currency.address)} <Icon name="external" size={12} /></a>}</div>
      <strong className="numeric" title={balance === undefined ? undefined : formatUnits(balance, currency.decimals)}>
        {balance === undefined ? '—' : formatBalance(balance, currency.decimals)}</strong>
      <Button appearance="ghost" disabled={balance === undefined || balance === 0n} onClick={() => onSend({ currency, balance })}>{m.send}</Button>
    </div>)}
  </div>
}
