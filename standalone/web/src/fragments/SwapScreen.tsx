import { deploymentKey } from './config'
import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { encodeFunctionData, formatEther, parseEther } from 'viem'
import { Button } from '../components/primitives'
import { poolAbi } from './abi'
import { approveIfNeeded, minimum } from './client'
import type { ScreenProps } from './types'
export function SwapScreen({ client, deployment: d, snapshot: s, account, m, prepare }: ScreenProps): ReactElement {
  const [shareIn, setShareIn] = useState(false), [amount, setAmount] = useState(''), [slippage, setSlippage] = useState('0.5')
  let input = 0n
  try { if (/^\d+(\.\d{0,18})?$/.test(amount)) input = parseEther(amount) } catch { /* invalid input disables quote */ }
  const quote = useQuery({ queryKey: ['fragment-quote', deploymentKey(d), shareIn, amount], enabled: input > 0n && s.okb > 0n,
    queryFn: () => client.readContract({ address: d.pool, abi: poolAbi, functionName: 'quote', args: [shareIn, input] }), refetchInterval: 12000, retry: false })
  const bps = Number(slippage) * 100
  const valid = input > 0n && Number.isInteger(bps) && bps >= 0 && bps < 10000 && !!quote.data?.[0]
  return <section className="fragment-card fragment-swap"><h1>{m.swap}</h1><p className="fragment-muted">OKB / sFAB</p>
    <label className="fragment-amount">{m.pay}<span className="fragment-input-row"><input aria-label={m.pay} inputMode="decimal" value={amount} placeholder="0.00" onChange={e => setAmount(e.target.value)} /><strong>{shareIn ? 'sFAB' : 'OKB'}</strong></span></label>
    <Button className="fragment-reverse" aria-label={m.reverse} onClick={() => setShareIn(!shareIn)}>↓</Button>
    <div className="fragment-amount"><span>{m.receive}</span><div className="fragment-input-row"><output>{quote.isFetching ? '…' : quote.data ? formatEther(quote.data[0]) : '—'}</output><strong>{shareIn ? 'OKB' : 'sFAB'}</strong></div></div>
    <p className="fragment-muted">{m.fee}</p><label className="fragment-field">{m.slippage}<input inputMode="decimal" value={slippage} onChange={e => setSlippage(e.target.value)} /></label>
    {quote.data && valid && <p>{m.minOut}: {formatEther(minimum(quote.data[0], bps))} {shareIn ? 'OKB' : 'sFAB'}</p>}
    {quote.isError && <p role="alert">{m.quoteError}</p>}{s.okb === 0n && <p>{m.noLiquidity}</p>}
    <Button appearance="primary" disabled={!account || !valid || quote.isFetching} onClick={() => prepare(m.swap, async () => {
      if (!account || !quote.data) throw new Error(m.walletRequired)
      if (shareIn) { const approval = await approveIfNeeded(client, d.vault, account, d.pool, input); if (approval) return { ...approval, label: m.approval } }
      return { to: d.pool, data: encodeFunctionData({ abi: poolAbi, functionName: 'swap', args: [shareIn, input, minimum(quote.data[0], bps), BigInt(Math.floor(Date.now() / 1000) + 1200)] }), value: shareIn ? 0n : input }
    })}>{m.preview}</Button>
  </section>
}
