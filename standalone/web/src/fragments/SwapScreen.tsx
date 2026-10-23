import { deploymentKey, shareSymbol, shareToken } from './config'
import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { encodeFunctionData, formatEther } from 'viem'
import { Button } from '../components/primitives'
import { poolAbi } from './abi'
import { approveIfNeeded, minimum } from './client'
import type { ScreenProps } from './types'
import type { PairSelection } from '../features/swap/pairExtension'
import { AmountPanel } from '../features/swap/AmountPanel'
import { formatBalance, parseAmount } from '../domain/amount'
import { tradeMessages } from '../i18n/trade'
import { NATIVE_CURRENCY } from '../liquidity/config'
import { usePreferences } from '../preferences/context'
import '../features/swap/swap.css'
export function SwapScreen({ client, deployment: d, snapshot: s, account, m, prepare, selection, onConnect, onAddLiquidity, busy }: ScreenProps & { selection?: PairSelection; onConnect?: () => void; onAddLiquidity?: () => void }): ReactElement {
  const { locale, t } = usePreferences(), trade = tradeMessages(locale)
  const [localShareIn, setShareIn] = useState(false), [amount, setAmount] = useState(''), [slippage, setSlippage] = useState('0.5')
  const shareIn = selection ? !selection.from.native : localShareIn
  const parsed = parseAmount(amount), input = parsed.kind === 'valid' ? parsed.units : 0n
  const fromBalance = shareIn ? s.shareBalance : s.okbBalance, toBalance = shareIn ? s.okbBalance : s.shareBalance
  const insufficient = !!account && input > fromBalance
  const error = insufficient ? t('amountInsufficient') : parsed.kind === 'invalid' ? t(parsed.error.code === 'amountPrecision' ? 'amountInvalid' : parsed.error.code) : undefined
  const share = { address: shareToken(d), symbol: shareSymbol(d), name: 'Soda miner shares', decimals: 18, native: false }
  const from = selection?.from ?? (shareIn ? share : NATIVE_CURRENCY), to = selection?.to ?? (shareIn ? NATIVE_CURRENCY : share)
  const balance = (value: bigint): string => `${trade.balance} ${account ? formatBalance(value) : '—'}`
  const hasLiquidity = s.okb > 0n && s.shares > 0n
  const quote = useQuery({ queryKey: ['fragment-quote', deploymentKey(d), shareIn, amount], enabled: input > 0n && hasLiquidity && !insufficient,
    queryFn: () => client.readContract({ address: d.pool, abi: poolAbi, functionName: 'quote', args: [shareIn, input] }), refetchInterval: 12000, retry: false })
  const bps = Number(slippage) * 100
  const valid = hasLiquidity && input > 0n && !error && Number.isInteger(bps) && bps >= 0 && bps < 10000 && !!quote.data?.[0]
  return <section className="fragment-card fragment-swap swap-card general-swap"><h1>{m.swap}</h1><p className="fragment-muted">OKB / {share.symbol}</p>
    <AmountPanel currency={from} pay amount={amount} onAmount={setAmount} balance={balance(fromBalance)} balanceExact={account ? `${formatEther(fromBalance)} ${from.symbol}` : undefined}
      disabled={!!busy} error={!!error} hint={from.native ? trade.nativeMax : undefined} onSelect={selection ? () => selection.onSelect('from') : undefined}
      onMax={account && shareIn ? () => setAmount(formatEther(fromBalance)) : undefined} />
    <Button className="fragment-reverse" disabled={busy} aria-label={m.reverse} onClick={() => { setAmount(''); if (selection) selection.onReverse(); else setShareIn(!shareIn) }}>↓</Button>
    <AmountPanel currency={to} amount={!hasLiquidity ? '' : quote.isFetching ? '…' : quote.data ? formatEther(quote.data[0]) : ''} balance={balance(toBalance)}
      balanceExact={account ? `${formatEther(toBalance)} ${to.symbol}` : undefined} disabled={!!busy} readOnly estimated onSelect={selection ? () => selection.onSelect('to') : undefined} />
    {error && <p id="swap-amount-error" role="alert" className="amount-error">{error}</p>}
    <div className="fragment-fee-row"><span>{m.fee}</span><span>0.5%</span></div><details className="fragment-trade-settings"><summary>{m.tradeSettings}<span>{slippage}%</span></summary><label className="fragment-field">{m.slippage}<input inputMode="decimal" value={slippage} onChange={e => setSlippage(e.target.value)} /></label></details>
    {quote.data && valid && <p>{m.minOut}: {formatEther(minimum(quote.data[0], bps))} {shareIn ? 'OKB' : share.symbol}</p>}
    {hasLiquidity && quote.isError && <p role="alert">{m.quoteError}</p>}{!hasLiquidity && <div className="fragment-actions"><p role="status">{m.poolEmpty}</p>{onAddLiquidity && <Button onClick={onAddLiquidity} disabled={busy}>{m.add}</Button>}</div>}{s.tradingPaused && <p role="status">{m[s.pauseReason ?? 'tradingPaused']}</p>}
    <Button appearance="primary" disabled={busy || (!account && !onConnect) || (!!account && (!valid || quote.isFetching || s.tradingPaused))} onClick={() => { if (!account) { onConnect?.(); return }; prepare(m.swap, async () => {
      if (!hasLiquidity) throw new Error(m.noLiquidity)
      if (!account || !quote.data) throw new Error(m.walletRequired)
      if (s.tradingPaused) throw new Error(m[s.pauseReason ?? 'tradingPaused'])
      if (shareIn) { const approval = await approveIfNeeded(client, shareToken(d), account, d.pool, input); if (approval) return { ...approval, label: m.approval } }
      return { to: d.pool, data: encodeFunctionData({ abi: poolAbi, functionName: 'swap', args: [shareIn, input, minimum(quote.data[0], bps), BigInt(Math.floor(Date.now() / 1000) + 1200)] }), value: shareIn ? 0n : input }
    }) }}>{account ? insufficient ? t('amountInsufficient') : m.preview : m.connect}</Button>
  </section>
}
