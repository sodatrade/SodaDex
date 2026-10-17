import { useId, useState, type ReactElement } from 'react'
import { Button, Surface } from '../components/primitives'
import { usePreferences } from '../preferences/context'
import { miningMessages } from './messages'
import type { MiningAction } from './plans'

interface Props {
  title: string; actions: readonly MiningAction[]; note?: string; disabled: boolean; assetSymbol?: string; initialAmount?: string
  onPreview: (action: MiningAction, amount: string, second: string, slip: number) => Promise<void>
}
export function MiningActionCard({ title, actions, note, disabled, assetSymbol = 'TEST-fFAB', initialAmount = '', onPreview }: Props): ReactElement {
  const { locale } = usePreferences(), m = miningMessages(locale), id = useId()
  const [action, setAction] = useState(actions[0]), [amount, setAmount] = useState(initialAmount), [second, setSecond] = useState('')
  const lp = action.endsWith('Add') || action.endsWith('Remove')
  // Upstream useLPSlippageValues uses 2.5% for non-native pools. Swaps retain 0.5%.
  const [swapSlip, setSwapSlip] = useState('0.5'), [lpSlip, setLpSlip] = useState('2.5')
  const [preparing, setPreparing] = useState(false)
  const miner = action === 'depositMiner' || action === 'redeemMiner' || action === 'buyMiner'
  return <Surface className="mining-action-card">
    <h2>{title}</h2>
    <form onSubmit={(event) => {
      event.preventDefault(); if (preparing || disabled) return
      setPreparing(true)
      void onPreview(action, amount, second, Number(lp ? lpSlip : swapSlip) * 100).finally(() => setPreparing(false))
    }}>
      <label htmlFor={`${id}-action`}>{title}</label>
      <select id={`${id}-action`} value={action} disabled={disabled || preparing} onChange={(e) => {
        const next = actions.find((a) => a === e.target.value); if (next) { setAction(next); setAmount(''); setSecond('') }
      }}>{actions.map((a) => <option key={a} value={a}>{m[a]}</option>)}</select>
      <label htmlFor={`${id}-amount`}>{action === 'buyMiner' ? m.listingId : miner ? m.minerId : m.amount}</label>
      <div className="mining-amount-field"><input id={`${id}-amount`} inputMode={miner ? 'numeric' : 'decimal'}
        placeholder="0" value={amount} required autoComplete="off" disabled={disabled || preparing} onChange={(e) => setAmount(e.target.value)} />
        <span>{action === 'buyMiner' ? '#' : miner ? 'NFT' : action.endsWith('Remove') ? 'LP' : action === 'getTestFab' ? 'TEST-OKB' : action === 'fragmentBuy' || action === 'projectBuy' ? 'TEST-FAB' : assetSymbol}</span></div>
      {action.endsWith('Add') && <><label htmlFor={`${id}-second`}>{m.secondAmount}</label>
        <input id={`${id}-second`} inputMode="decimal" placeholder="0" value={second} required autoComplete="off" disabled={disabled || preparing} onChange={(e) => setSecond(e.target.value)} /></>}
      {action !== 'burnBoost' && action !== 'buyMiner' && <div className="mining-slippage"><label htmlFor={`${id}-slip`}>{m.slippage}</label>
        <input id={`${id}-slip`} inputMode="decimal" value={lp ? lpSlip : swapSlip} required disabled={disabled || preparing}
          onChange={(e) => lp ? setLpSlip(e.target.value) : setSwapSlip(e.target.value)} /></div>}
      <Button appearance="primary" type="submit" disabled={disabled || preparing || !amount}>{preparing ? m.miningChecking : m.preview}</Button>
    </form>
    {note && <p className="dialog-note">{note}</p>}
  </Surface>
}
