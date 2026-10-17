import type { ReactElement } from 'react'
import { STABLE_ADDRESS, WOKB_ADDRESS } from '../domain/assets'
import { tokenIcon } from '../domain/tokenIcons'
import { AssetIcon } from './primitives'

/** Use the issuer's pinned mark; unknown contracts keep a neutral initial. */
export function TokenIcon({ address, symbol, native = false, small = false }: {
  address: string; symbol: string; native?: boolean; small?: boolean
}): ReactElement {
  const normalized = address.toLowerCase()
  const known = native || /^0x0{40}$/i.test(address) ? 'okb'
    : normalized === WOKB_ADDRESS.toLowerCase() ? 'wokb'
    : normalized === STABLE_ADDRESS.toLowerCase() ? 'usdt0' : undefined
  if (known) return <AssetIcon assetId={known} small={small} />
  const source = tokenIcon(address, native)
  return source ? <span className={`asset-icon${small ? ' small' : ''}`} aria-hidden="true">
    <img src={source} alt="" width="42" height="42" />
  </span> : <span className="swap-token-initial" aria-hidden="true">{symbol.slice(0, 2).toUpperCase()}</span>
}
