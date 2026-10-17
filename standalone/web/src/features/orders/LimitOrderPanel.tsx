import './orders.css'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { formatUnits } from 'viem'
import { Button, Icon, Surface } from '../../components/primitives'
import { amountError, parseAmount } from '../../domain/amount'
import { CHAIN_ID, EXPLORER_URL, type Protocol } from '../../domain/assets'
import { rememberToken } from '../../domain/tokenCatalog'
import { orderMessages } from '../../i18n/orders'
import { hexQuantity, rpc } from '../../lib/rpc'
import type { WalletController } from '../../lib/useWallet'
import { KNOWN_CURRENCIES, listPools } from '../../liquidity'
import type { Currency } from '../../liquidity/types'
import { usePreferences } from '../../preferences/context'
import { CurrencyPicker, CurrencyIcon } from '../swap/CurrencyPicker'
import { currencyKey, sameCurrency } from '../swap/routes'
import { useTokenCatalog } from '../swap/useTokenCatalog'
import { marketContext, type TradeMarketContext } from '../trade/context'
import { orderServiceReady } from './api'
import { ORDER_DEPLOYMENT, type OrderDeployment } from './config'
import { draftOrder, orderNonce } from './model'
import { OrderList } from './OrderList'
import { orderPools } from './OrderPools'
import { OrderReview } from './OrderReview'
import { OrderSubmissionCard } from './OrderSubmissionCard'
import { useLimitOperation, type LimitReview } from './useLimitOperation'
interface Props { wallet: WalletController; onConnect: () => void; onSwap: () => void; seed?: TradeMarketContext; onContextChange?: (context: TradeMarketContext) => void; active?: boolean; deployment?: OrderDeployment }
export function LimitOrderPanel({ wallet, onConnect, onSwap, seed, onContextChange, active = true, deployment = ORDER_DEPLOYMENT }: Props): ReactElement {
  const { locale, t } = usePreferences(), m = orderMessages(locale)
  const [from, setFrom] = useState<Currency>(() => seed?.from && !seed.from.native ? seed.from : KNOWN_CURRENCIES[1])
  const [to, setTo] = useState<Currency>(() => seed?.to && !sameCurrency(seed.to, from) ? seed.to : KNOWN_CURRENCIES[2])
  const [amount, setAmount] = useState(''), [minimum, setMinimum] = useState(''), [expiry, setExpiry] = useState('')
  const [protocol, setProtocol] = useState<Protocol>('auto'), [poolId, setPoolId] = useState(''), [selector, setSelector] = useState<'from' | 'to'>()
  const [imported, setImported] = useState<Currency[]>([]), [review, setReview] = useState<LimitReview>()
  const catalog = useTokenCatalog()
  const pools = useQuery({ queryKey: ['liquidity', 'pools'], queryFn: () => listPools(), retry: false, refetchInterval: 30_000 })
  const available = useMemo(() => orderPools(pools.data ?? [], from, to, protocol), [pools.data, from, to, protocol]), selected = available.find(p => p.id === poolId) ?? available[0]
  const context = useMemo(() => marketContext({ from, to, protocol, pools: selected ? [selected] : [], loading: pools.isPending, failed: pools.isError }), [from, to, protocol, selected, pools.isPending, pools.isError])
  useEffect(() => { onContextChange?.(context) }, [context, onContextChange])
  const service = useQuery({ queryKey: ['order-service-ready', deployment?.settlement], queryFn: () => orderServiceReady(deployment!), enabled: !!deployment && active, retry: false })
  const ready = !!deployment && deployment.executionEnabled === true && service.data === true && !service.isError
  const operation = useLimitOperation(wallet, deployment, ready)
  useEffect(() => { if (operation.submission) setReview(undefined) }, [operation.submission])
  const identity = wallet.getIdentity(), account = wallet.session?.chainId === CHAIN_ID ? wallet.session.address : undefined
  const balance = useQuery({ queryKey: ['order-balance', account, currencyKey(from)], enabled: !!account && !from.native && active, retry: false,
    queryFn: async () => hexQuantity(await rpc('eth_call', [{ to: from.address, data: `0x70a08231${account!.slice(2).padStart(64, '0')}` }, 'latest'])) })
  const amountValue = parseAmount(amount, from.decimals), minValue = parseAmount(minimum, to.decimals)
  const expiryValue = Math.floor(Date.parse(expiry) / 1000)
  const valid = !!selected && !from.native && amountValue.kind === 'valid' && minValue.kind === 'valid' && amountValue.units < 2n ** 128n && minValue.units < 2n ** 128n &&
    !amountError(amount, balance.data, from.decimals) && Number.isFinite(expiryValue) && expiryValue > Date.now() / 1000
  const locked = operation.busy || operation.unresolved || !!operation.submission
  const changed = (): void => { operation.changed(); setReview(undefined) }
  const currencies = [...KNOWN_CURRENCIES, ...imported, ...catalog, ...(pools.data ?? []).flatMap(p => [p.currency0, p.currency1])].filter((c, i, all) => all.findIndex(v => currencyKey(v) === currencyKey(c)) === i)
  const select = (currency: Currency): void => {
    changed(); setPoolId('')
    if (!currencies.some(c => sameCurrency(c, currency))) setImported(all => [...all, currency])
    if (!currency.native) rememberToken(currency.address)
    if (selector === 'from') { setFrom(currency); if (sameCurrency(currency, to)) setTo(from) }
    else { setTo(currency); if (sameCurrency(currency, from)) setFrom(to) }
    setAmount(''); setMinimum(''); setSelector(undefined)
  }
  const preview = (): void => {
    if (!wallet.session) { onConnect(); return }
    if (wallet.session.chainId !== CHAIN_ID) { void wallet.switchChain(); return }
    if (!ready || !deployment || !identity || !valid || !selected || balance.data === undefined || locked) return
    try { setReview(operation.review(draftOrder({ from, to, pool: selected, amount, minimum, expiry }, deployment, identity.address, orderNonce(), BigInt(Math.floor(Date.now() / 1000))), identity)) } catch { /* Validation below keeps malformed drafts outside the wallet boundary. */ }
  }
  const price = amountValue.kind === 'valid' && minValue.kind === 'valid' ? formatUnits(minValue.units * 10n ** BigInt(from.decimals) * 10n ** 18n / (amountValue.units * 10n ** BigInt(to.decimals)), 18) : undefined
  return <>
    <Surface className="limit-panel" aria-label={m.title}><h2>{m.title}</h2><p className="order-note">{m.note}</p>
      {!ready && <p role="status" className="order-readiness">{!deployment || deployment.executionEnabled !== true ? m.notReady : service.isError || service.data === false ? m.serviceFailed : m.loading}</p>}
      {deployment && <Button appearance="icon" className="limit-refresh" aria-label={m.retry} title={m.retry} onClick={() => void service.refetch()} disabled={service.isFetching}><Icon name="refresh" size={17} /></Button>}
      <form onSubmit={(event) => { event.preventDefault(); preview() }}>
        <div className="limit-amount-field"><label htmlFor="limit-pay-amount">{m.pay}</label><div className="limit-amount-row"><input id="limit-pay-amount" aria-label={m.pay} inputMode="decimal" placeholder="0" value={amount} disabled={locked} onChange={e => { changed(); setAmount(e.target.value.slice(0, 100)) }} />
          <Button type="button" aria-label={m.input} disabled={locked} onClick={() => setSelector('from')}><CurrencyIcon currency={from} /><span>{from.symbol}</span><Icon name="chevron" size={14} /></Button></div>
          <p className="order-note">{m.balance}: {balance.isFetching ? '…' : balance.isError || balance.data === undefined ? '—' : formatUnits(balance.data, from.decimals)} {from.symbol}</p></div>
        <div className="limit-amount-field"><label htmlFor="limit-receive-amount">{m.minimum}</label><div className="limit-amount-row"><input id="limit-receive-amount" aria-label={m.minimum} inputMode="decimal" placeholder="0" value={minimum} disabled={locked} onChange={e => { changed(); setMinimum(e.target.value.slice(0, 100)) }} />
          <Button type="button" aria-label={m.output} disabled={locked} onClick={() => setSelector('to')}><CurrencyIcon currency={to} /><span>{to.symbol}</span><Icon name="chevron" size={14} /></Button></div></div>
        <p className="order-price"><span>{m.price}</span><strong>{price ? `≈ ${price} ${to.symbol} / ${from.symbol}` : '—'}</strong></p>
        <label>{m.expiry}<input aria-label={m.expiry} type="datetime-local" value={expiry} disabled={locked} onChange={e => { changed(); setExpiry(e.target.value) }} /></label><small className="order-note">{m.expiryNote}</small>
        <label>{m.pool}<select aria-label={m.pool} value={protocol} disabled={locked} onChange={e => { changed(); setProtocol(e.target.value as Protocol); setPoolId('') }}><option value="auto">V3 + V4</option><option value="v3">V3</option><option value="v4">V4</option></select></label>
        {available.length > 0 ? <select aria-label={`${m.pool} ID`} value={selected?.id} disabled={locked} onChange={e => { changed(); setPoolId(e.target.value) }}>{available.map(p => <option key={p.id} value={p.id}>{p.protocol.toUpperCase()} · {p.fee / 10000}% · {p.id}</option>)}</select> : <p className="order-note">{pools.isPending ? m.loading : pools.isError ? m.unavailable : m.noPool}</p>}
        {(amount || minimum || expiry) && !valid && <p className="error-text" role="alert">{m.invalid}</p>}
        <Button className="order-primary" appearance="primary" type="submit" disabled={!!wallet.session && wallet.session.chainId === CHAIN_ID && (!ready || !valid || balance.data === undefined || balance.isError || locked)}>{!wallet.session ? m.connect : wallet.session.chainId !== CHAIN_ID ? m.network : m.preview}</Button>
      </form>
      <p className="order-note">{m.nativeNote}</p><Button onClick={onSwap}>{m.goSwap}</Button>
      {operation.error && !review && <p role="alert" className="error-text">{t(operation.error)}</p>}
      {operation.record && !review && <div className="order-submission"><a className="transaction-link" href={`${EXPLORER_URL}/tx/${operation.record.hash}`} target="_blank" rel="noreferrer">{m.tx}</a>
        {operation.unresolved && <><p className="order-note">{m.receiptRecovered}</p><Button onClick={() => void operation.recheck()} disabled={operation.busy || operation.checking}>{m.receipt}</Button></>}</div>}
      <OrderSubmissionCard operation={operation} wallet={wallet} deployment={deployment} currencies={currencies} />
    </Surface>
    <OrderList wallet={wallet} deployment={deployment} ready={!!deployment} currencies={currencies} operation={operation} active={active} />
    {selector && <CurrencyPicker currencies={selector === 'from' ? currencies.filter(c => !c.native) : currencies} selected={selector === 'from' ? from : to} onSelect={select} onClose={() => setSelector(undefined)} />}
    {review && <OrderReview review={review} operation={operation} currencies={currencies} ready={ready} onClose={() => { operation.changed(); setReview(undefined) }} />}
  </>
}
