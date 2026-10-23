import { useEffect, useState, type ReactElement } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatUnits } from 'viem'
import { Dialog } from '../../components/Dialog'
import { Button } from '../../components/primitives'
import { EXPLORER_URL } from '../../domain/assets'
import { liquidityText } from '../../i18n/liquidity'
import type { WalletController } from '../../lib/useWallet'
import { discoverV2, getV2Position } from '../../liquidity/v2Pools'
import { prepareV2, type V2Preview } from '../../liquidity/v2Preview'
import { liquidityError } from '../../liquidity/execution'
import type { AnyPool, V2Pool } from '../../liquidity/v2Types'
import { usePreferences } from '../../preferences/context'
import type { TradeIdentity } from '../../trading/types'
import { useWalletOperation } from '../history/useWalletOperation'
import { confirmedPoolsKey, mergeConfirmedPools } from './confirmedPools'
import { decimalInput } from './presentation'

export function V2LiquidityDialog({ pool, wallet, onClose, onBusyChange }: {
  pool: V2Pool; wallet: WalletController; onClose: () => void; onBusyChange: (value: boolean) => void
}): ReactElement {
  const { locale, t } = usePreferences(), l = liquidityText(locale), zh = locale === 'zh-CN'
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [amount0, setAmount0] = useState(''), [amount1, setAmount1] = useState('')
  const [liquidity, setLiquidity] = useState(''), [slippage, setSlippage] = useState('0.5')
  const [review, setReview] = useState<{ preview: V2Preview; identity: TradeIdentity }>()
  const [currentPool, setCurrentPool] = useState(pool)
  const [balanceError, setBalanceError] = useState(false)
  const operation = useWalletOperation(wallet), queryClient = useQueryClient()
  const owner = wallet.session?.address
  const position = useQuery({ queryKey: ['liquidity', 'v2-position', owner, currentPool.id],
    queryFn: () => getV2Position(currentPool, owner!), enabled: !!owner, retry: false })
  const prepare = useMutation({ retry: false, mutationFn: async () => {
    const identity = wallet.getIdentity()
    if (!identity) throw Error('Wallet not connected')
    const slippageBps = Number(decimalInput(slippage, 2))
    const op = mode === 'add' ? { kind: 'add' as const, pool: currentPool,
      amount0: decimalInput(amount0, pool.currency0.decimals), amount1: decimalInput(amount1, pool.currency1.decimals), slippageBps } :
      { kind: 'remove' as const, pool: currentPool, liquidity: decimalInput(liquidity, 18), slippageBps }
    return { preview: await prepareV2(op, identity.address), identity }
  }, onSuccess: setReview })
  const busy = prepare.isPending || operation.busy || operation.unresolved
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  useEffect(() => {
    if (operation.progress?.stage !== 'tradeSucceeded' && operation.receiptMessage !== 'confirmed') return
    let alive = true
    void queryClient.invalidateQueries({ queryKey: ['liquidity'] })
    void discoverV2(pool.currency0, pool.currency1).then(fresh => {
      queryClient.setQueryData<AnyPool[]>(confirmedPoolsKey, previous => mergeConfirmedPools([fresh], previous ?? []))
      if (alive) setCurrentPool(fresh)
      void queryClient.invalidateQueries({ queryKey: ['liquidity'] })
    }).catch(() => { /* The confirmed receipt remains visible; the directory retries discovery independently. */ })
    return () => { alive = false }
  }, [operation.progress?.stage, operation.receiptMessage, pool.currency0, pool.currency1, queryClient])
  const done = operation.progress?.stage === 'tradeSucceeded' || operation.receiptMessage === 'confirmed'
  const current = !!review && wallet.getIdentity()?.revision === review.identity.revision
  return <Dialog title={l('manage')} description={`${pool.currency0.symbol} / ${pool.currency1.symbol} · V2 · 0.3%`} onClose={() => { if (!operation.busy) onClose() }} onEscape={() => operation.busy}>
    <p className="lp-muted">{zh ? '手续费留在池中，撤出流动性时一并取回。加减流动性只付网络费。' : 'Trading fees stay in the pool and are withdrawn with liquidity. Adding or removing only costs network gas.'}</p>
    {currentPool.address && <a className="lp-code" href={`${EXPLORER_URL}/address/${currentPool.address}`} target="_blank" rel="noreferrer">{currentPool.address}</a>}
    {!review ? <form className="lp-form" onSubmit={e => { e.preventDefault(); operation.reset(); prepare.mutate() }}>
      <div className="lp-tabs" role="group" aria-label={l('liquidity')}>
        <button type="button" aria-pressed={mode === 'add'} disabled={busy} onClick={() => setMode('add')}>{l('add')}</button>
        <button type="button" aria-pressed={mode === 'remove'} disabled={busy || !currentPool.initialized} onClick={() => setMode('remove')}>{l('decrease')}</button>
      </div>
      {mode === 'add' ? <>
        {!currentPool.initialized && <p className="lp-muted">{zh ? '首次投入的两种币数量决定开盘价；确认后同时创建池子并注入流动性。' : 'Your initial token ratio sets the price. Confirmation creates and funds the pool together.'}</p>}
        <div className="lp-form-grid">{[{ c: pool.currency0, value: amount0, set: setAmount0 }, { c: pool.currency1, value: amount1, set: setAmount1 }].map(({ c, value, set }, i) => <label className="lp-field" key={c.address}>{c.symbol}<input data-dialog-autofocus={i === 0 || undefined} inputMode="decimal" placeholder="0" value={value} onChange={e => set(e.target.value)} disabled={busy} required /></label>)}</div>
      </> : <><label className="lp-field">{l('liquidity')} · LP<input data-dialog-autofocus inputMode="decimal" value={liquidity} onChange={e => setLiquidity(e.target.value)} disabled={busy || position.isFetching} required /></label>
        <Button type="button" disabled={busy || position.isFetching} onClick={() => {
          setBalanceError(false)
          void position.refetch().then(result => {
            if (result.isError || !result.data) { setBalanceError(true); return }
            setLiquidity(formatUnits(result.data.balance, 18))
          })
        }}>{zh ? '全部 LP' : 'All LP'}</Button>
        {balanceError && <p role="alert">{l('loadFailed')}</p>}</>}
      <label className="lp-field">{l('slippage')}<input inputMode="decimal" value={slippage} onChange={e => setSlippage(e.target.value)} disabled={busy} /></label>
      {position.data && <p className="lp-muted">{zh ? '我的 LP' : 'My LP'} · {formatUnits(position.data.balance, 18)}</p>}
      {prepare.error && <p className="error-text" role="alert">{l(liquidityError(prepare.error))}</p>}
      <Button type="submit" appearance="primary" disabled={busy || (mode === 'remove' && position.isFetching)}>{l(prepare.isPending ? 'preparingPreview' : 'preview')}</Button>
    </form> : <>
      <dl className="lp-review">{[pool.currency0, pool.currency1].map((c, i) => <div key={c.address}><dt>{c.symbol}</dt><dd>{formatUnits(i ? review.preview.amount1 : review.preview.amount0, c.decimals)}</dd></div>)}
        <div><dt>LP</dt><dd>{formatUnits(review.preview.liquidity, 18)}</dd></div>
        <div><dt>{l('slippage')}</dt><dd>{formatUnits(BigInt(review.preview.operation.slippageBps), 2)}%</dd></div>
      </dl>
      <p className="lp-muted">{zh ? '以上为预计数量。按池内比例实际投入，多余 OKB 会退回钱包；撤出时按份额取回池内两种币。' : 'Amounts are estimates. Deposits follow the reserve ratio and excess OKB is refunded; withdrawals return both pool assets.'}</p>
      {!current && !done && <p role="alert">{l('identityChanged')}</p>}
      <div className="lp-actions"><Button disabled={busy} onClick={() => { if (done) onClose(); else { setReview(undefined); operation.reset() } }}>{done ? l('close') : l('back')}</Button>
        {!done && <Button appearance="primary" disabled={busy || !current || !!operation.error} onClick={() => operation.execute({ kind: 'v2Liquidity', preview: review.preview }, review.identity)}>{l('confirm')}</Button>}</div>
    </>}
    {operation.progress && <p role="status">{operation.progress.stage === 'tradeSucceeded' ? l('stageSuccess') : t(operation.progress.stage)}</p>}
    {operation.error && <p role="alert" className="error-text">{t(operation.error)}</p>}
    {operation.record && <a href={`${EXPLORER_URL}/tx/${operation.record.hash}`} target="_blank" rel="noreferrer">{l('recent')}</a>}
    {operation.unresolved && !operation.busy && <Button disabled={operation.checking} onClick={() => void operation.recheck()}>{l('checkReceipt')}</Button>}
  </Dialog>
}
