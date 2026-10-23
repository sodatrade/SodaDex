import { useQuery } from '@tanstack/react-query'
import { useRef, useState, type ReactElement } from 'react'
import { formatUnits } from 'viem'
import { amountError, formatBalance, parseAmount } from '../domain/amount'
import { CHAIN_ID, EXPLORER_URL, getAsset, shortenAddress, type AssetId, type Protocol } from '../domain/assets'
import type { WalletController } from '../lib/useWallet'
import { usePreferences } from '../preferences/context'
import { POOLS, publicSwapsEnabled } from '../trading/config'
import { getQuote } from '../trading/quotes'
import type { Quote, TradeIdentity } from '../trading/types'
import { useTrade } from '../trading/useTrade'
import { AssetDialog } from './AssetDialog'
import { Button, Icon, NetworkIcon, Surface } from './primitives'
import { SettingsDialog } from './SettingsDialog'
import { SwapAmountPanel } from './SwapAmountPanel'
import { TradeConfirmation } from './TradeConfirmation'
interface SwapCardProps {
  wallet: WalletController
  balances: Record<AssetId, bigint> | undefined
  balancesLoading: boolean
  balancesError: boolean
  onConnect: () => void
}
export function SwapCard({ wallet, balances, balancesLoading, balancesError, onConnect }: SwapCardProps): ReactElement {
  const [fromId, setFromId] = useState<AssetId>('okb')
  const [toId, setToId] = useState<AssetId>('usdt0')
  const [amount, setAmount] = useState('')
  const [selector, setSelector] = useState<'from' | 'to'>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [protocol, setProtocol] = useState<Protocol>('auto')
  const [review, setReview] = useState<{ quote: Quote; identity: TradeIdentity }>()
  const [reviewOpen, setReviewOpen] = useState(false)
  const formRevision = useRef(0)
  const trade = useTrade(wallet, formRevision)
  const { t } = usePreferences()
  const from = getAsset(fromId),
    to = getAsset(toId)
  const parsed = parseAmount(amount, from.decimals)
  const tradingEnabled = publicSwapsEnabled()
  const error =
    amountError(amount, balances?.[fromId], from.decimals) ??
    (parsed.kind === 'valid' && parsed.units >= 2n ** 128n ? { code: 'amountTooLarge' as const } : undefined)
  const supported = (fromId === 'okb' && toId === 'usdt0') || (fromId === 'usdt0' && toId === 'okb')
  const quote = useQuery({
    queryKey: ['quote', fromId, toId, parsed.kind === 'valid' ? parsed.units.toString() : '', protocol],
    queryFn: () => getQuote({ from: fromId, to: toId, amount: parsed.kind === 'valid' ? parsed.units : 0n }, protocol),
    enabled: POOLS.ready && supported && parsed.kind === 'valid' && !error,
    refetchInterval: 15_000,
    retry: false,
  })
  const wrongChain = wallet.session && wallet.session.chainId !== CHAIN_ID
  const locked = trade.busy || trade.unresolved
  const walletBusy = wallet.status !== 'idle'
  const changed = (): void => {
    formRevision.current += 1
    trade.cancel()
    trade.reset()
    setReview(undefined)
    setReviewOpen(false)
  }
  const selectAsset = (id: AssetId): void => {
    changed()
    if (selector === 'from') {
      if (id === toId) setToId(fromId)
      setFromId(id)
    } else {
      if (id === fromId) setFromId(toId)
      setToId(id)
    }
    setAmount('')
    setSelector(undefined)
  }
  const balanceText = (id: AssetId): string =>
    !wallet.session || wrongChain
      ? t('balanceEmpty')
      : balancesLoading
        ? t('balanceLoading')
        : balancesError
          ? t('balanceUnavailable')
          : balances
            ? t('balanceValue', { amount: formatBalance(balances[id], getAsset(id).decimals) })
            : t('balanceEmpty')
  const action = (): void => {
    if (locked) {
      setReviewOpen(true)
      return
    }
    if (!wallet.session) {
      onConnect()
      return
    }
    if (wrongChain) {
      void wallet.switchChain()
      return
    }
    if (!tradingEnabled) return
    const identity = wallet.getIdentity()
    if (quote.data && identity) {
      trade.reset()
      setReview({ quote: quote.data, identity })
      setReviewOpen(true)
    }
  }
  const disabled =
    walletBusy ||
    (!tradingEnabled && !locked && !wrongChain) ||
    (!!wallet.session &&
      !wrongChain &&
      !locked &&
      (!POOLS.ready || !supported || !!error || !quote.data || quote.isFetching))
  const label = locked
    ? 'viewTransaction'
    : walletBusy
      ? 'waitingWallet'
      : wrongChain
        ? 'switchNetwork'
        : !tradingEnabled
          ? 'tradePaused'
          : !wallet.session
            ? 'connectWallet'
            : !POOLS.ready
            ? 'contractsPending'
            : !supported
              ? 'tradeUnsupported'
              : parsed.kind !== 'valid'
                ? 'enterAmount'
                : quote.isFetching
                  ? 'quoteLoading'
                  : quote.isError
                    ? 'tradeUnavailable'
                    : 'reviewSwap'
  return (
    <>
      <Surface className="swap-card" aria-label={t('swapRegion')}>
        <div className="swap-card-heading">
          <div>
            <h2>{t('navSwap')}</h2>
            <span className="card-caption">{t('swapCaption')}</span>
          </div>
          <Button
            appearance="icon"
            aria-label={t('swapSettings')}
            onClick={() => setSettingsOpen(true)}
            disabled={locked}
          >
            <Icon name="settings" />
          </Button>
        </div>
        <SwapAmountPanel
          id={fromId}
          pay
          amount={amount}
          onAmount={(value) => {
            changed()
            setAmount(value)
          }}
          onSelect={() => setSelector('from')}
          balance={balanceText(fromId)}
          error={!!error}
          disabled={locked}
          hint={t(fromId === 'okb' ? 'nativeAsset' : fromId === 'usdt0' ? 'stableAsset' : 'wrappedAsset')}
        />
        <div className="direction-row">
          <Button
            appearance="icon"
            className="direction-button"
            aria-label={t('changeDirection')}
            disabled={locked}
            onClick={() => {
              changed()
              setFromId(toId)
              setToId(fromId)
              setAmount('')
            }}
          >
            <Icon name="arrow" size={19} />
          </Button>
        </div>
        <SwapAmountPanel
          id={toId}
          amount={quote.data && supported && !error ? formatUnits(quote.data.amountOut, to.decimals) : '—'}
          onSelect={() => setSelector('to')}
          balance={balanceText(toId)}
          disabled={locked}
          hint={t(
            !POOLS.ready
              ? 'quotePending'
              : !supported
                ? 'tradeUnsupported'
                : quote.isFetching
                  ? 'quoteLoading'
                  : quote.data
                    ? tradingEnabled ? 'quoteReady' : 'quoteReadOnly'
                    : 'enterAmount',
          )}
        />
        {error && (
          <p id="amount-error" className="amount-error" role="alert">
            {error.code === 'amountPrecision' ? t(error.code, { decimals: error.decimals }) : t(error.code)}
          </p>
        )}
        {quote.isError && POOLS.ready && supported && (
          <p className="error-text" role="alert">
            {t('tradeUnavailable')}{' '}
            <button className="text-button" onClick={() => void quote.refetch()}>
              {t('quoteRetry')}
            </button>
          </p>
        )}
        <div className="route-summary">
          <span>
            <NetworkIcon small />X Layer
          </span>
          <button onClick={() => setSettingsOpen(true)} disabled={locked}>
            {t('route', {
              protocol:
                quote.data?.protocol.toUpperCase() ??
                (protocol === 'auto' ? t('protocolAuto') : protocol.toUpperCase()),
            })}
            <Icon name="chevron" size={14} />
          </button>
        </div>
        <Button appearance="primary" className="swap-action" disabled={disabled} onClick={action}>
          {t(label)}
          {!wallet.session && <Icon name="wallet" size={19} />}
        </Button>
        <p className="swap-footnote">
          <span className="status-dot" />
          {t(!tradingEnabled ? 'tradingPausedNote' : POOLS.ready ? 'tradeNotice' : 'swapReadOnly')}
        </p>
        {trade.progress && (
          <p className="trade-status" role="status">
            {t(trade.progress.stage)}
          </p>
        )}
        {trade.lastSubmitted?.hash && (
          <a
            className="transaction-link"
            href={`${EXPLORER_URL}/tx/${trade.lastSubmitted.hash}`}
            target="_blank"
            rel="noreferrer"
          >
            {t('recentTransaction')} {shortenAddress(trade.lastSubmitted.hash)}
            <Icon name="external" size={14} />
          </a>
        )}
        {wallet.error && (
          <p className="error-text" role="alert">
            {t(wallet.error)}
          </p>
        )}
      </Surface>
      {selector && (
        <AssetDialog
          selected={selector === 'from' ? fromId : toId}
          onSelect={selectAsset}
          onClose={() => setSelector(undefined)}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          protocol={protocol}
          onChange={(value) => {
            changed()
            setProtocol(value)
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {reviewOpen && review && (
        <TradeConfirmation
          {...review}
          trade={trade}
          current={wallet.getIdentity()?.revision === review.identity.revision}
          onConfirm={() => trade.execute(review.quote, review.identity)}
          onClose={() => {
            trade.cancel()
            setReviewOpen(false)
          }}
        />
      )}
    </>
  )
}
