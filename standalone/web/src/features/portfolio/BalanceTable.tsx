import type { ReactElement } from 'react'
import { formatUnits } from 'viem'
import { Button, Icon } from '../../components/primitives'
import { formatBalance } from '../../domain/amount'
import { EXPLORER_URL, shortenAddress } from '../../domain/assets'
import { workspaceMessages } from '../../i18n/workspace'
import { CurrencyLabel } from '../liquidity/CurrencyLabel'
import { usePreferences } from '../../preferences/context'
import type { PortfolioToken } from './usePortfolioTokens'
export function BalanceTable({ tokens, onSend }: { tokens: PortfolioToken[]; onSend: (token: PortfolioToken) => void }): ReactElement {
  const { locale } = usePreferences(), m = workspaceMessages(locale)
  return <div className="portfolio-token-table">
    <div className="portfolio-token-head"><span>{m.token}</span><span>{m.balance}</span><span /></div>
    {tokens.map(({ currency, balance }) => <div className="portfolio-token-row" key={currency.address}>
      <div><CurrencyLabel currency={currency} /><small>{currency.name}</small>
        {!currency.native && <a href={`${EXPLORER_URL}/token/${currency.address}`} target="_blank" rel="noreferrer">
          {shortenAddress(currency.address)} <Icon name="external" size={12} /></a>}</div>
      <strong className="numeric" title={balance === undefined ? undefined : formatUnits(balance, currency.decimals)}>
        {balance === undefined ? '—' : formatBalance(balance, currency.decimals)}</strong>
      <Button appearance="ghost" disabled={balance === undefined || balance === 0n} onClick={() => onSend({ currency, balance })}>{m.send}</Button>
    </div>)}
  </div>
}
