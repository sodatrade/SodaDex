import { useState, type ReactElement } from 'react'
import { encodeFunctionData, formatEther, parseEther } from 'viem'
import { Button } from '../components/primitives'
import { roundedContribution } from './liquidityQuote'
import { poolAbi } from './abi'
import { approveIfNeeded, minimum } from './client'
import type { ScreenProps } from './types'
export function PoolForm({ client, deployment: d, snapshot: s, account, m, prepare }: ScreenProps): ReactElement {
  const [mode, setMode] = useState<'add' | 'remove'>('add'), [shares, setShares] = useState(''), [okb, setOkb] = useState(''), [lp, setLp] = useState(''), [slip, setSlip] = useState('0.5')
  return <section className="fragment-card"><h1>{m.liquidity}</h1><p className="fragment-muted">{m.principal}</p>
    <div className="fragment-segments">{(['add', 'remove'] as const).map(item => <Button key={item} aria-pressed={mode === item} onClick={() => setMode(item as typeof mode)}>{item === 'add' ? m.add : m.remove}</Button>)}</div>
    {mode !== 'remove' ? <div className="fragment-two"><label className="fragment-field">sFAB<input inputMode="decimal" placeholder="0.00" value={shares} onChange={e => setShares(e.target.value)} /></label><label className="fragment-field">OKB<input inputMode="decimal" placeholder="0.00" value={okb} onChange={e => setOkb(e.target.value)} /></label></div> : <div><label className="fragment-field">{m.lpAmount}<input inputMode="decimal" value={lp} onChange={e => setLp(e.target.value)} /></label><Button disabled={!account || s.lpBalance === 0n} onClick={() => setLp(formatEther(s.lpBalance))}>{m.allLp}</Button></div>}
    <label className="fragment-field">{m.slippage}<input inputMode="decimal" value={slip} onChange={e => setSlip(e.target.value)} /></label>
    {mode === 'add' && !s.preciseLiquidity && <p role="status" className="fragment-muted">{m.lpUpdating}</p>}
    <Button appearance="primary" disabled={!account || (mode === 'add' && !s.preciseLiquidity)} onClick={() => prepare(mode === 'add' ? m.add : m.remove, async () => {
      if (!account) throw new Error(m.walletRequired)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200), bps = Number(slip) * 100
      minimum(1n, bps)
      if (mode === 'remove') {
        const liquidity = parseEther(lp)
        if (liquidity <= 0n || s.lpSupply === 0n || liquidity > s.lpBalance) throw new Error(m.amountError)
        return { to: d.pool, data: encodeFunctionData({ abi: poolAbi, functionName: 'removeLiquidity', args: [liquidity, minimum(s.shares * liquidity / s.lpSupply, bps), minimum(s.okb * liquidity / s.lpSupply, bps), deadline] }) }
      }
      if (!s.preciseLiquidity) throw new Error(m.lpUpdating)
      const desiredShares = parseEther(shares), value = parseEther(okb)
      if (desiredShares <= 0n || value <= 0n) throw new Error(m.amountError)
      const approval = await approveIfNeeded(client, d.vault, account, d.pool, desiredShares)
      if (approval) return { ...approval, label: m.approval }
      const { shares: actualShares, okb: actualOkb } = roundedContribution(desiredShares, value, s.shares, s.okb, s.lpSupply)
      return { to: d.pool, data: encodeFunctionData({ abi: poolAbi, functionName: 'addLiquidity', args: [desiredShares, minimum(actualShares, bps), minimum(actualOkb, bps), deadline] }), value }
    })}>{m.preview}</Button>
  </section>
}
