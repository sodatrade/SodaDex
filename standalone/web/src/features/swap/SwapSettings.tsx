import type { ReactElement } from 'react'
import { Dialog } from '../../components/Dialog'
import type { Protocol } from '../../domain/assets'
import { tradeMessages } from '../../i18n/trade'
import { usePreferences } from '../../preferences/context'
import { slippageValue } from './routes'
export function SwapSettings({ protocol, slippage, onProtocol, onSlippage, onClose }: {
  protocol: Protocol; slippage: string; onProtocol: (p: Protocol) => void; onSlippage: (s: string) => void; onClose: () => void
}): ReactElement {
  const { locale } = usePreferences(), m = tradeMessages(locale)
  return <Dialog title={m.details} description={m.singleHop} onClose={onClose}>
    <fieldset className="swap-route-options"><legend>{m.route}</legend>{(['auto', 'v3', 'v4'] as const).map((p) => <label key={p}>
      <input type="radio" name="swap-protocol" checked={protocol === p} onChange={() => onProtocol(p)} />{p === 'auto' ? m.auto : p.toUpperCase()}</label>)}</fieldset>
    <label className="swap-slippage">{m.slippage}<span><input aria-label={m.slippage} inputMode="decimal" value={slippage} onChange={(e) => onSlippage(e.target.value.slice(0, 8))} />%</span></label>
    {slippageValue(slippage) === undefined && <p role="alert" className="error-text">{m.slippageError}</p>}
  </Dialog>
}
