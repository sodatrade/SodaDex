import { useState, type ReactElement } from 'react'
import { Dialog } from '../components/Dialog'
import { formatBalance } from './format'
import { PoolForm } from './PoolForm'
import { formatEther } from 'viem'
import type { ScreenProps } from './types'
import { shareSymbol, shareToken } from './config'
import { PoolManageButton } from '../features/liquidity/PoolManageButton'
import { TokenIcon } from '../components/TokenIcon'

/** One row per real pool; its form is opened only by an explicit user action. */
export function PoolScreen(props: ScreenProps & { rowOnly?: boolean; controlledOpen?: boolean; onOpenChange?: (open: boolean) => void }): ReactElement {
  const [localOpen, setLocalOpen] = useState(false)
  const open = props.controlledOpen ?? localOpen, setOpen = props.onOpenChange ?? setLocalOpen
  const { snapshot: s, account, m, busy } = props
  if (props.rowOnly) return <><div className="lp-pool" role="row"><div className="lp-pair" role="cell"><span className="lp-currency"><TokenIcon address="0x0000000000000000000000000000000000000000" symbol="OKB" native small /><strong>OKB</strong></span><span>/</span><span className="lp-currency"><TokenIcon address={shareToken(props.deployment)} symbol={shareSymbol(props.deployment)} small /><strong>{shareSymbol(props.deployment)}</strong></span></div><span role="cell">{m.specialPool} · 0.5%</span><span role="cell" className="lp-pool-status">{s.okb > 0n && s.shares > 0n ? m.poolReady : m.poolEmpty}</span><div className="lp-actions" role="cell"><PoolManageButton label={m.manage} disabled={busy} onClick={() => setOpen(true)} /></div></div>{open && <Dialog className="fragment-liquidity-dialog" title={`OKB / ${shareSymbol(props.deployment)}`} description={m.specialPool} onEscape={() => !!busy} onClose={() => { if (!busy) setOpen(false) }}><div className="fragment-overview"><span>{m.reserves}</span><strong title={formatEther(s.okb)}>{formatBalance(s.okb)} OKB</strong><strong title={formatEther(s.shares)}>{formatBalance(s.shares)} {shareSymbol(props.deployment)}</strong></div><fieldset className="fragment-workspace" disabled={busy}><PoolForm {...props} /></fieldset></Dialog>}</>
  return <section className="fragment-pool-list" aria-label={m.liquidity}>
    <div className="fragment-pool-columns" aria-hidden="true"><span>{m.pair}</span><span>{m.reserves}</span><span>{m.lpAmount}</span><span>{m.manage}</span></div>
    <button className="fragment-pool-row" aria-label={`${m.manage} OKB / ${shareSymbol(props.deployment)}`} aria-haspopup="dialog" disabled={busy} onClick={() => setOpen(true)}>
      <span className="fragment-pair"><span className="fragment-pair-symbol" aria-hidden="true">S</span><span><strong>OKB / {shareSymbol(props.deployment)}</strong><small>{m.specialPool} · 0.5%</small></span></span>
      <span className="fragment-pool-reserves"><strong>{formatBalance(s.okb)} OKB</strong><small>{formatBalance(s.shares)} {shareSymbol(props.deployment)}</small></span>
      <span className="fragment-pool-position">{account ? formatBalance(s.lpBalance) : '—'}<small>LP</small></span>
      <span className="fragment-row-action">{m.manage}<span aria-hidden="true">↗</span></span>
    </button>
    {open && <Dialog className="fragment-liquidity-dialog" title={`OKB / ${shareSymbol(props.deployment)}`} description={m.specialPool} onEscape={() => !!busy} onClose={() => { if (!busy) setOpen(false) }}><PoolForm {...props} /></Dialog>}
  </section>
}
