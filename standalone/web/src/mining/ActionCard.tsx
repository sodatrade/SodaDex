import { useId, useState, type ReactElement } from 'react'
import { Button, Icon, Surface } from '../components/primitives'
import { usePreferences } from '../preferences/context'
import { miningMessages } from './messages'
import type { MiningAction } from './plans'

interface Props {
  title: string; actions: readonly MiningAction[]; note?: string; disabled: boolean; locked?: boolean; assetSymbol?: string; initialAmount?: string
  onConnect?: () => void
  onPreview: (action: MiningAction, amount: string, second: string, slip: number) => Promise<void>
}
export function MiningActionCard({ title, actions, note, disabled, locked = false, assetSymbol = 'TEST-fFAB', initialAmount = '', onConnect, onPreview }: Props): ReactElement {
  const { locale, t } = usePreferences(), m = miningMessages(locale), id = useId()
  const [action, setAction] = useState(actions[0]), [amount, setAmount] = useState(initialAmount), [second, setSecond] = useState('')
  const lp = action.endsWith('Add') || action.endsWith('Remove')
  // Upstream useLPSlippageValues uses 2.5% for non-native pools. Swaps retain 0.5%.
  const [swapSlip, setSwapSlip] = useState('0.5'), [lpSlip, setLpSlip] = useState('2.5')
  const [preparing, setPreparing] = useState(false)
  const miner = action === 'depositMiner' || action === 'redeemMiner' || action === 'buyMiner'
  return <Surface className="mining-action-card">
    <header className="mining-card-heading"><h2>{title}</h2><span>1952 · TESTNET</span></header>
    <form onSubmit={(event) => {
      event.preventDefault(); if (preparing || disabled) return
      setPreparing(true)
      void onPreview(action, amount, second, Number(lp ? lpSlip : swapSlip) * 100).finally(() => setPreparing(false))
    }}>
      {actions.length > 1 && <div className="mining-action-switch" role="group" aria-label={title}>
        {actions.map((next) => <Button key={next} type="button" appearance="ghost" aria-pressed={action === next} disabled={locked || preparing}
          onClick={() => { if (next !== action) { setAction(next); setAmount(''); setSecond('') } }}>{m[next]}</Button>)}
      </div>}
      <label htmlFor={`${id}-amount`}>{action === 'buyMiner' ? m.listingId : miner ? m.minerId : m.amount}</label>
      <div className="mining-amount-field"><input id={`${id}-amount`} inputMode={miner ? 'numeric' : 'decimal'}
        placeholder="0" value={amount} required autoComplete="off" disabled={locked || preparing} onChange={(e) => setAmount(e.target.value)} />
        <span>{action === 'buyMiner' ? '#' : miner ? 'NFT' : action.endsWith('Remove') ? 'LP' : action === 'getTestFab' ? 'TEST-OKB' : action === 'fragmentBuy' || action === 'projectBuy' ? 'TEST-FAB' : assetSymbol}</span></div>
      {action.endsWith('Add') && <><label htmlFor={`${id}-second`}>{m.secondAmount}</label>
        <div className="mining-amount-field"><input id={`${id}-second`} inputMode="decimal" placeholder="0" value={second} required autoComplete="off" disabled={locked || preparing} onChange={(e) => setSecond(e.target.value)} /><span>TEST-FAB</span></div></>}
      {action !== 'burnBoost' && action !== 'buyMiner' && <details className="mining-settings"><summary><span><Icon name="settings" size={15} />{m.transactionSettings}</span><span>{lp ? lpSlip : swapSlip}%<Icon name="chevron" size={14} /></span></summary><div className="mining-slippage"><label htmlFor={`${id}-slip`}>{m.slippage}</label>
        <input id={`${id}-slip`} inputMode="decimal" value={lp ? lpSlip : swapSlip} required disabled={locked || preparing}
          onChange={(e) => lp ? setLpSlip(e.target.value) : setSwapSlip(e.target.value)} /></div></details>}
      {onConnect ? <Button appearance="primary" type="button" onClick={onConnect}><Icon name="wallet" size={17} />{t('connectWallet')}</Button>
        : <Button appearance="primary" type="submit" disabled={disabled || preparing || !amount}>{preparing ? m.miningChecking : m.preview}<Icon name="arrow" size={17} /></Button>}
    </form>
    {note && <p className="dialog-note">{note}</p>}
  </Surface>
}
