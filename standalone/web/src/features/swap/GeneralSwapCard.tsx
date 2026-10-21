import './swap.css'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { formatUnits, type Address } from 'viem'
import { Button, Icon, NetworkIcon, Surface } from '../../components/primitives'
import { amountError, formatBalance, parseAmount } from '../../domain/amount'
import { CHAIN_ID, EXPLORER_URL, shortenAddress, STABLE_ADDRESS, type AssetId, type Protocol } from '../../domain/assets'
import { rememberToken } from '../../domain/tokenCatalog'
import { tradeMessages } from '../../i18n/trade'
import { hexQuantity, rpc } from '../../lib/rpc'
import type { WalletController } from '../../lib/useWallet'
import { KNOWN_CURRENCIES, listPools, NATIVE_CURRENCY } from '../../liquidity'
import type { Currency } from '../../liquidity/types'
import { usePreferences } from '../../preferences/context'
import { publicSwapsEnabled } from '../../trading/config'
import type { TradeIdentity } from '../../trading/types'
import { marketContext, type TradeMarketContext } from '../trade/context'
import { AmountPanel } from './AmountPanel'
import { CurrencyPicker } from './CurrencyPicker'
import { bestPoolQuote, bestPoolExactOutputQuote, currencyKey, isExactOutput, matchingPools, quotedInput, sameCurrency, slippageValue, wrapDirection, type SwapPoolQuote } from './routes'
import { SwapReviewDialog } from './SwapReviewDialog'
import { SwapSettings } from './SwapSettings'
import { TradeDetails } from './TradeDetails'
import { useTokenCatalog } from './useTokenCatalog'
import { useSwapOperation, type SwapReview } from './useSwapOperation'
interface Props {
  wallet: WalletController; balances: Record<AssetId, bigint> | undefined
  balancesLoading: boolean; balancesError: boolean; onConnect: () => void; onCreatePool?: () => void; onContextChange?: (context: TradeMarketContext) => void; onBusyChange?: (busy: boolean) => void
}
function builtin(currency: Currency): AssetId | undefined {
  if (currency.native) return 'okb'
  const index = KNOWN_CURRENCIES.findIndex((c) => !c.native && sameCurrency(c, currency))
  return index === 1 ? 'wokb' : index === 2 ? 'usdt0' : undefined
}
async function customBalance(currency: Currency, address: Address): Promise<bigint> {
  return hexQuantity(await rpc('eth_call', [{ to: currency.address, data: `0x70a08231${address.slice(2).padStart(64, '0')}` }, 'latest']))
}
export function GeneralSwapCard({ wallet, balances, balancesLoading, balancesError, onConnect, onCreatePool, onContextChange, onBusyChange }: Props): ReactElement {
  const { locale, t } = usePreferences(), m = tradeMessages(locale)
  const [from, setFrom] = useState<Currency>(NATIVE_CURRENCY)
  const [to, setTo] = useState<Currency>(KNOWN_CURRENCIES.find((c) => c.address.toLowerCase() === STABLE_ADDRESS.toLowerCase()) ?? KNOWN_CURRENCIES[2])
  const [imported, setImported] = useState<Currency[]>([])
  const catalog = useTokenCatalog()
  const [amount, setAmount] = useState(''), [editedSide, setEditedSide] = useState<'from' | 'to'>('from')
  const [selector, setSelector] = useState<'from' | 'to'>()
  const [protocol, setProtocol] = useState<Protocol>('auto'), [slippage, setSlippage] = useState('0.5')
  const [settings, setSettings] = useState(false)
  const [review, setReview] = useState<{ value: SwapReview; identity: TradeIdentity; from: Currency; to: Currency }>()
  const operation = useSwapOperation(wallet), locked = operation.busy || operation.unresolved
  useEffect(() => { onBusyChange?.(locked || !!review || !!selector || settings) }, [locked, review, selector, settings, onBusyChange])
  const wrongChain = !!wallet.session && wallet.session.chainId !== CHAIN_ID
  const enabled = publicSwapsEnabled(), bps = slippageValue(slippage)
  const fromBuiltin = builtin(from), toBuiltin = builtin(to)
  const account = !wrongChain ? wallet.session?.address : undefined
  const custom = useQuery({ queryKey: ['swap', 'balances', account, currencyKey(from), currencyKey(to)],
    queryFn: async () => Promise.all([from, to].map((c) => builtin(c) || !account ? undefined : customBalance(c, account))),
    enabled: !!account && (!fromBuiltin || !toBuiltin), retry: false, refetchInterval: 15_000 })
  const fromBalance = fromBuiltin ? balances?.[fromBuiltin] : custom.data?.[0]
  const toBalance = toBuiltin ? balances?.[toBuiltin] : custom.data?.[1]
  const specified = editedSide === 'from' ? from : to
  const parsed = parseAmount(amount, specified.decimals)
  const entryError = amountError(amount, undefined, specified.decimals) ??
    (parsed.kind === 'valid' && parsed.units >= 2n ** 128n ? { code: 'amountTooLarge' as const } : undefined)
  const direction = wrapDirection(from, to)
  const pools = useQuery({ queryKey: ['liquidity', 'pools'], queryFn: () => listPools(), retry: false, refetchInterval: 30_000 })
  const matches = matchingPools(pools.data ?? [], from, to, protocol)
  const quote = useQuery<SwapPoolQuote>({ queryKey: ['swap', 'quote', currencyKey(from), currencyKey(to), protocol, bps, editedSide,
    matches.map((p) => p.pool.id).join(','), parsed.kind === 'valid' ? parsed.units.toString() : ''],
    queryFn: () => (editedSide === 'to' ? bestPoolExactOutputQuote : bestPoolQuote)(matches, parsed.kind === 'valid' ? parsed.units : 0n, bps ?? 50),
    enabled: !direction && matches.length > 0 && parsed.kind === 'valid' && !entryError && bps !== undefined,
    retry: false, refetchInterval: 15_000 })
  const validQuote = !quote.isError && matches.length > 0 && !entryError ? quote.data : undefined
  const requiredInput = direction || editedSide === 'from' ? parsed.kind === 'valid' ? parsed.units : undefined
    : validQuote && isExactOutput(validQuote) ? validQuote.maximumIn : undefined
  const error = entryError ?? (account && fromBalance !== undefined && requiredInput !== undefined && requiredInput > fromBalance
    ? { code: 'amountInsufficient' as const } : undefined)
  const context = useMemo(() => marketContext({ from, to, protocol, pools: pools.data, loading: pools.isPending,
    failed: pools.isError, quote: validQuote }),
    [from, to, protocol, pools.data, pools.isPending, pools.isError, validQuote])
  useEffect(() => { onContextChange?.(context) }, [context, onContextChange])
  const currencies = [...KNOWN_CURRENCIES, ...imported, ...catalog, ...(pools.data ?? []).flatMap((p) => [p.currency0, p.currency1])]
    .filter((c, index, all) => all.findIndex((v) => currencyKey(v) === currencyKey(c)) === index)
  const changed = (): void => { operation.cancel(); operation.reset(); setReview(undefined) }
  const select = (currency: Currency): void => {
    changed()
    if (!currencies.some((c) => sameCurrency(c, currency))) setImported((all) => [...all, currency])
    if (!currency.native && !builtin(currency)) rememberToken(currency.address)
    if (selector === 'from') { if (sameCurrency(currency, to)) setTo(from); setFrom(currency) }
    else { if (sameCurrency(currency, from)) setFrom(to); setTo(currency) }
    setAmount(''); setEditedSide('from'); setSelector(undefined)
  }
  const balanceText = (value: bigint | undefined, known: AssetId | undefined, currency: Currency): string => {
    const loading = known ? balancesLoading : custom.isFetching, failed = known ? balancesError : custom.isError
    return `${m.balance} ${!account ? '—' : loading ? '…' : failed || value === undefined ? '—' : formatBalance(value, currency.decimals)}`
  }
  const quoteReady = direction ? parsed.kind === 'valid' && !error : !!quote.data && !quote.isFetching && !quote.isError && !error && matches.length > 0
  const action = (): void => {
    if (!wallet.session) { onConnect(); return }
    if (wrongChain) { void wallet.switchChain(); return }
    const identity = wallet.getIdentity()
    if (!identity || !enabled || locked || !quoteReady || (!direction && bps === undefined) || fromBalance === undefined) return
    operation.reset()
    const value: SwapReview | undefined = direction && parsed.kind === 'valid' ? { kind: 'wrap', request: { direction, amount: parsed.units } }
      : validQuote ? isExactOutput(validQuote) ? { kind: 'exactOutput', quote: validQuote } : { kind: 'pool', quote: validQuote } : undefined
    if (value) setReview({ value, identity, from, to })
  }
  const calculated = !entryError && parsed.kind === 'valid' ? direction ? formatUnits(parsed.units, editedSide === 'from' ? to.decimals : from.decimals)
    : validQuote ? formatUnits(editedSide === 'from' ? validQuote.amountOut : quotedInput(validQuote), editedSide === 'from' ? to.decimals : from.decimals) : '' : ''
  const payAmount = editedSide === 'from' ? amount : calculated, receiveAmount = editedSide === 'to' ? amount : calculated
  const editAmount = (side: 'from' | 'to', value: string): void => { changed(); setEditedSide(side); setAmount(value) }
  const reviewSpend = review?.value.kind === 'wrap' ? review.value.request.amount : review?.value.kind === 'exactOutput'
    ? review.value.quote.maximumIn : review?.value.quote.amount
  const now = wallet.getIdentity()
  const current = review && now?.revision === review.identity.revision && now?.provider === review.identity.provider
    && now?.address.toLowerCase() === review.identity.address.toLowerCase() && now?.chainId === CHAIN_ID
    && fromBalance !== undefined && reviewSpend !== undefined && fromBalance >= reviewSpend
  const label = wallet.status !== 'idle' ? t('waitingWallet') : wrongChain ? t('switchNetwork') : !wallet.session ? t('connectWallet')
    : !enabled ? m.paused : locked ? m.pending : error ? t(error.code === 'amountPrecision' ? 'amountInvalid' : error.code)
      : parsed.kind !== 'valid' ? t('enterAmount') : quote.isFetching ? m.quote : direction ? m[direction] : m.review
  return <>
    <Surface className="swap-card general-swap" aria-label={t('swapRegion')}>
      <div className="swap-card-heading"><h2>{m.title}</h2>
        <Button appearance="icon" aria-label={t('swapSettings')} onClick={() => setSettings(true)} disabled={locked}><Icon name="settings" /></Button></div>
      <AmountPanel currency={from} pay amount={payAmount} estimated={!direction && editedSide === 'to'} balance={balanceText(fromBalance, fromBuiltin, from)} disabled={locked}
        error={!!error && (editedSide === 'from' || error.code === 'amountInsufficient')} hint={validQuote && isExactOutput(validQuote) ? `${m.maximum}: ${formatUnits(validQuote.maximumIn, from.decimals)} ${from.symbol}${from.native ? ` · ${m.nativeMax}` : ''}` : from.native ? m.nativeMax : undefined} onSelect={() => setSelector('from')}
        onMax={!from.native && fromBalance !== undefined && account ? () => editAmount('from', formatUnits(fromBalance, from.decimals)) : undefined}
        onAmount={(value) => editAmount('from', value)} />
      <div className="direction-row"><Button appearance="icon" className="direction-button" aria-label={t('changeDirection')} disabled={locked}
        onClick={() => { changed(); setFrom(to); setTo(from); setAmount(''); setEditedSide('from') }}><Icon name="arrow" size={19} /></Button></div>
      <AmountPanel currency={to} amount={receiveAmount} estimated={!direction && editedSide === 'from'} error={!!entryError && editedSide === 'to'} onAmount={(value) => editAmount('to', value)} balance={balanceText(toBalance, toBuiltin, to)} disabled={locked} onSelect={() => setSelector('to')}
        hint={direction ? m.wrapping : quote.isFetching ? m.quote : !enabled ? m.readonly : undefined} />
      {error && <p id="swap-amount-error" role="alert" className="amount-error">{error.code === 'amountPrecision' ? t(error.code, { decimals: error.decimals }) : t(error.code)}</p>}
      {!direction && bps === undefined && <p role="alert" className="error-text">{m.slippageError}</p>}
      {!direction && pools.isPending && <p role="status" className="swap-notice">{m.loading}</p>}
      {!direction && pools.isError && <p role="alert" className="error-text">{m.poolError} <button className="text-button" onClick={() => void pools.refetch()}>{m.reload}</button></p>}
      {!direction && pools.isSuccess && !matches.length && <p className="swap-notice">{m.noPool}{onCreatePool && <> <button className="text-button" onClick={onCreatePool}>{m.createPool}</button></>}</p>}
      {!direction && quote.isError && !quote.isFetching && <p role="alert" className="error-text">{m.noQuote} <button className="text-button" onClick={() => void quote.refetch()}>{m.reload}</button></p>}
      <div className="route-summary"><span><NetworkIcon small />X Layer</span><button onClick={() => setSettings(true)} disabled={locked}>
        {m.route} · {direction ? '1:1' : validQuote?.pool.protocol.toUpperCase() ?? (protocol === 'auto' ? m.auto : protocol.toUpperCase())}<Icon name="chevron" size={14} /></button></div>
      {validQuote && !direction && <div className="swap-quote-summary"><TradeDetails quote={validQuote} scope="summary" />
        <details className="swap-quote-details"><summary>{m.details}<Icon name="chevron" size={14} /></summary>
          <TradeDetails quote={validQuote} scope="route" /><p className="swap-notice">{m.singleHop}</p><p className="swap-notice">{m.impactNote}</p></details></div>}
      {validQuote && !direction && isExactOutput(validQuote) && <p className="swap-notice">{m.standardTokens}</p>}
      <Button appearance="primary" className="swap-action" onClick={action} disabled={wallet.status !== 'idle' || (!!wallet.session && !wrongChain && (!enabled || locked || !quoteReady || (!direction && bps === undefined) || fromBalance === undefined))}>{label}</Button>
      <p className="swap-footnote"><span className="status-dot" />{m.test}</p>
      {operation.recovered && <p className="swap-notice">{m.recovered}</p>}
      {operation.progress && <p role="status" className="trade-status">{t(operation.progress.stage)}</p>}
      {operation.receiptMessage && <p role="status">{m[operation.receiptMessage]}</p>}
      {operation.error && <p role="alert" className="error-text">{editedSide === 'to' && !direction && operation.error === 'tradeQuoteChanged' ? m.exactQuoteChanged : t(operation.error)}</p>}
      {operation.record && <div className="swap-submitted"><a className="transaction-link" href={`${EXPLORER_URL}/tx/${operation.record.hash}`} target="_blank" rel="noreferrer">{m.submitted} {shortenAddress(operation.record.hash)} <Icon name="external" size={14} /></a>
        {operation.unresolved && <Button onClick={() => void operation.recheck()} disabled={operation.checking || operation.busy}>{m[operation.checking ? 'loading' : 'receipt']}</Button>}</div>}
      {wallet.error && <p role="alert" className="error-text">{t(wallet.error)}</p>}
    </Surface>
    {selector && <CurrencyPicker currencies={currencies} selected={selector === 'from' ? from : to} onSelect={select} onClose={() => setSelector(undefined)} />}
    {settings && <SwapSettings protocol={protocol} slippage={slippage} onProtocol={(p) => { changed(); setProtocol(p) }} onSlippage={(value) => { changed(); setSlippage(value) }} onClose={() => setSettings(false)} />}
    {review && <SwapReviewDialog review={review.value} from={review.from} to={review.to} current={!!current} operation={operation}
      onConfirm={() => { if (current && enabled && !locked) operation.execute(review.value, review.identity) }} onClose={() => { operation.cancel(); setReview(undefined) }} />}
  </>
}
