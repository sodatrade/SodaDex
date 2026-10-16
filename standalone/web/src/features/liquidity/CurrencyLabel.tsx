import type { ReactElement } from 'react'
import { TokenIcon } from '../../components/TokenIcon'
import type { Currency } from '../../liquidity/types'
export function CurrencyLabel({ currency }: { currency: Currency }): ReactElement {
  return (
    <span className="lp-currency">
      <TokenIcon address={currency.address} symbol={currency.symbol} native={currency.native} small />
      <span>{currency.symbol}</span>
    </span>
  )
}
