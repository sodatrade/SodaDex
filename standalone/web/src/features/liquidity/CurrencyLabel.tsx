import type { ReactElement } from 'react'
import { AssetIcon } from '../../components/primitives'
import type { Currency } from '../../liquidity/types'
import { assetId } from './presentation'
export function CurrencyLabel({ currency }: { currency: Currency }): ReactElement {
  const id = assetId(currency)
  return (
    <span className="lp-currency">
      {id && <AssetIcon assetId={id} small />}
      <span>{currency.symbol}</span>
    </span>
  )
}
