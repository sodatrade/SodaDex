<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'
  import WalletIcon from '@lucide/svelte/icons/wallet'
  import { createQuery, useQueryClient } from '@tanstack/svelte-query'
  import { onDestroy } from 'svelte'
  import { toast } from 'svelte-sonner'
  import { formatUnits, type Hex } from 'viem'
  import * as Alert from '$lib/components/ui/alert'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Spinner } from '$lib/components/ui/spinner'
  import type { WalletController } from '$lib/wallet.svelte'
  import { amountError, formatBalance, parseAmount } from '../domain/amount'
  import { CHAIN_ID, EXPLORER_URL, getAsset, shortenAddress, type AssetId, type Protocol } from '../domain/assets'
  import type { PlainMessageKey } from '../i18n/types'
  import { usePreferences } from '../preferences/preferences.svelte'
  import { POOLS } from '../trading/config'
  import { getQuote } from '../trading/quotes'
  import { TradeController, type TradeNotice } from '../trading/trade.svelte'
  import type { Quote, TradeIdentity } from '../trading/types'
  import AmountPanel from './AmountPanel.svelte'
  import AssetDialog from './AssetDialog.svelte'
  import { assetHint } from './labels'
  import NetworkIcon from './NetworkIcon.svelte'
  import SettingsDialog from './SettingsDialog.svelte'
  import TradeReview from './TradeReview.svelte'

  let {
    wallet,
    balances,
    balancesLoading,
    balancesError,
    onConnect,
    protocol = $bindable('auto'),
    locked = $bindable(false),
  }: {
    wallet: WalletController
    balances: Record<AssetId, bigint> | undefined
    balancesLoading: boolean
    balancesError: boolean
    onConnect: () => void
    protocol?: Protocol
    /** Mirrors the trade lock outward so other pages cannot change the form mid-trade. */
    locked?: boolean
  } = $props()
  const { t } = usePreferences()
  const queryClient = useQueryClient()

  let fromId = $state<AssetId>('okb')
  let toId = $state<AssetId>('usdt0')
  let amount = $state('')
  let selector = $state<'from' | 'to'>()
  let settingsOpen = $state(false)
  let review = $state.raw<{ quote: Quote; identity: TradeIdentity }>()
  let reviewOpen = $state(false)
  // Plain counters: execution reads them synchronously between wallet calls.
  let formRevision = 0
  let executing: Quote | undefined = undefined

  const explorerAction = (hash: Hex) => ({
    label: t('viewTransaction'),
    onClick: () => window.open(`${EXPLORER_URL}/tx/${hash}`, '_blank', 'noopener,noreferrer'),
  })
  const swapDetail = (): string | undefined => {
    if (!executing) return undefined
    const fromAsset = getAsset(executing.from)
    return t('toastSwapDetail', {
      amount: formatBalance(executing.amount, fromAsset.decimals),
      from: fromAsset.symbol,
      to: getAsset(executing.to).symbol,
    })
  }
  // Toasts follow each wallet transaction by hash, so a later state replaces the earlier one in place.
  const notify = (notice: TradeNotice): void => {
    if (notice.type === 'submitted') {
      const swap = notice.kind === 'swap'
      toast.loading(t(swap ? 'toastSwapSubmitted' : 'toastApprovalSubmitted'), {
        id: notice.hash,
        description: swap ? swapDetail() : undefined,
        action: explorerAction(notice.hash),
      })
    } else if (notice.type === 'confirmed') {
      const swap = notice.kind === 'swap'
      toast.success(t(swap ? 'toastSwapSucceeded' : 'toastApprovalConfirmed'), {
        id: notice.hash,
        description: swap ? swapDetail() : undefined,
        action: explorerAction(notice.hash),
        duration: swap ? 8000 : 4000,
      })
    } else if (notice.hash) {
      const unknown = notice.code === 'tradePending' || notice.code === 'tradeFailed'
      toast[unknown ? 'warning' : 'error'](t(unknown ? 'toastTransactionPending' : 'toastTransactionFailed'), {
        id: notice.hash,
        description: t(notice.code),
        action: explorerAction(notice.hash),
        duration: 10000,
      })
    } else if (!reviewOpen) {
      // The open review dialog already shows this inline; a closed one would otherwise hide it.
      if (notice.code === 'tradeRejected') toast(t('tradeRejected'))
      else toast.error(t(notice.code))
    }
  }
  const trade = new TradeController({
    getIdentity: () => wallet.getIdentity(),
    formRevision: () => formRevision,
    notify,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['balances'] })
      void queryClient.invalidateQueries({ queryKey: ['pool-stats'] })
    },
  })
  onDestroy(() => trade.destroy())

  const from = $derived(getAsset(fromId))
  const to = $derived(getAsset(toId))
  const parsed = $derived(parseAmount(amount, from.decimals))
  const error = $derived(
    amountError(amount, balances?.[fromId], from.decimals) ??
      (parsed.kind === 'valid' && parsed.units >= 2n ** 128n ? { code: 'amountTooLarge' as const } : undefined),
  )
  const supported = $derived((fromId === 'okb' && toId === 'usdt0') || (fromId === 'usdt0' && toId === 'okb'))
  const quote = createQuery(() => ({
    queryKey: ['quote', fromId, toId, parsed.kind === 'valid' ? parsed.units.toString() : '', protocol],
    queryFn: () => getQuote({ from: fromId, to: toId, amount: parsed.kind === 'valid' ? parsed.units : 0n }, protocol),
    enabled: POOLS.ready && supported && parsed.kind === 'valid' && !error,
    refetchInterval: 15_000,
    retry: false,
  }))
  // Background refreshes keep the visible quote; only a quote for new inputs counts as loading.
  const quoteLoading = $derived(quote.isFetching && !quote.data)
  const wrongChain = $derived(!!wallet.session && wallet.session.chainId !== CHAIN_ID)
  const isLocked = $derived(trade.busy || trade.unresolved)
  $effect(() => {
    locked = isLocked
  })
  const walletBusy = $derived(wallet.status !== 'idle')
  const visibleQuote = $derived(quote.data && supported && !error ? quote.data : undefined)

  function changed(): void {
    formRevision += 1
    trade.cancel()
    trade.reset()
    review = undefined
    reviewOpen = false
  }
  /** Starts a swap paying with `id` (against the other side of the OKB / USD₮0 pair). */
  export function chooseFrom(id: AssetId): void {
    if (isLocked) return
    changed()
    fromId = id
    toId = id === 'okb' ? 'usdt0' : 'okb'
    amount = ''
  }
  /** Protocol changes from outside the card follow the same path as the settings dialog. */
  export function chooseProtocol(value: Protocol): void {
    if (isLocked) return
    changed()
    protocol = value
  }
  function selectAsset(id: AssetId): void {
    changed()
    if (selector === 'from') {
      if (id === toId) toId = fromId
      fromId = id
    } else {
      if (id === fromId) fromId = toId
      toId = id
    }
    amount = ''
    selector = undefined
  }
  function balanceText(id: AssetId): string {
    if (!wallet.session || wrongChain) return t('balanceEmpty')
    if (balancesLoading) return t('balanceLoading')
    if (balancesError) return t('balanceUnavailable')
    return balances ? t('balanceValue', { amount: formatBalance(balances[id], getAsset(id).decimals) }) : t('balanceEmpty')
  }
  function action(): void {
    if (isLocked) {
      reviewOpen = true
      return
    }
    if (!wallet.session) return onConnect()
    if (wrongChain) return void wallet.switchChain()
    const identity = wallet.getIdentity()
    if (quote.data && identity) {
      trade.reset()
      review = { quote: quote.data, identity }
      reviewOpen = true
    }
  }
  const disabled = $derived(
    walletBusy ||
      (!!wallet.session &&
        !wrongChain &&
        !isLocked &&
        (!POOLS.ready || !supported || !!error || !quote.data || quoteLoading || quote.isError)),
  )
  const label = $derived<PlainMessageKey>(
    isLocked
      ? 'viewTransaction'
      : walletBusy
        ? 'waitingWallet'
        : !wallet.session
          ? 'connectWallet'
          : wrongChain
            ? 'switchNetwork'
            : !POOLS.ready
              ? 'contractsPending'
              : !supported
                ? 'tradeUnsupported'
                : parsed.kind !== 'valid'
                  ? 'enterAmount'
                  : error
                    ? error.code === 'amountPrecision'
                      ? 'enterAmount'
                      : error.code
                    : quoteLoading
                      ? 'quoteLoading'
                      : quote.isError
                        ? 'tradeUnavailable'
                        : 'reviewSwap',
  )
  const receiveHint = $derived<PlainMessageKey>(
    !POOLS.ready
      ? 'quotePending'
      : !supported
        ? 'tradeUnsupported'
        : quoteLoading
          ? 'quoteLoading'
          : quote.data && !quote.isError
            ? 'quoteReady'
            : 'enterAmount',
  )
</script>

<Card.Root
  class="relative block px-4 pt-5 pb-4 sm:px-4 sm:pt-5 sm:pb-4 before:absolute before:inset-x-10 before:-top-px before:h-px before:bg-linear-to-r before:from-transparent before:via-primary/60 before:to-transparent"
>
<section aria-label={t('swapRegion')}>
  <div class="flex items-center justify-between px-2 pb-5">
    <div>
      <h2 class="mb-1 text-[19px] leading-snug font-medium">{t('navSwap')}</h2>
      <span class="text-[11px] text-muted-foreground">{t('swapCaption')}</span>
    </div>
    <Button variant="ghost" size="icon" aria-label={t('swapSettings')} onclick={() => (settingsOpen = true)} disabled={isLocked}>
      <SlidersHorizontal />
    </Button>
  </div>
  <AmountPanel
    id={fromId}
    pay
    {amount}
    onAmount={(value) => {
      changed()
      amount = value
    }}
    onSelect={() => (selector = 'from')}
    balance={balanceText(fromId)}
    error={!!error}
    disabled={isLocked}
    hint={t(assetHint(fromId))}
  />
  <div class="relative z-10 flex h-2.5 items-center justify-center">
    <Button
      variant="secondary"
      size="icon-sm"
      class="size-10 rounded-xl border-4 border-card text-muted-foreground hover:text-highlight"
      aria-label={t('changeDirection')}
      disabled={isLocked}
      onclick={() => {
        changed()
        ;[fromId, toId] = [toId, fromId]
        amount = ''
      }}
    >
      <ArrowDown />
    </Button>
  </div>
  <AmountPanel
    id={toId}
    amount={visibleQuote ? formatBalance(visibleQuote.amountOut, to.decimals) : '—'}
    exactAmount={visibleQuote ? formatUnits(visibleQuote.amountOut, to.decimals) : undefined}
    onSelect={() => (selector = 'to')}
    balance={balanceText(toId)}
    disabled={isLocked}
    hint={t(receiveHint)}
  />
  {#if error}
    <p id="amount-error" class="mx-2 mt-2.5 text-xs text-destructive" role="alert">
      {error.code === 'amountPrecision' ? t(error.code, { decimals: error.decimals }) : t(error.code)}
    </p>
  {/if}
  {#if quote.isError && POOLS.ready && supported}
    <Alert.Root variant="destructive" class="mt-3">
      <Alert.Description>{t('tradeUnavailable')}</Alert.Description>
      <Alert.Action>
        <Button variant="link" class="h-auto p-0 text-xs" onclick={() => void quote.refetch()}>{t('quoteRetry')}</Button>
      </Alert.Action>
    </Alert.Root>
  {/if}
  <div class="mx-2 my-4 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
    <span class="flex items-center gap-1.5"><NetworkIcon small />X Layer</span>
    <button
      class="-m-1.5 flex min-h-7 items-center gap-1 p-1.5 hover:text-foreground disabled:opacity-60"
      onclick={() => (settingsOpen = true)}
      disabled={isLocked}
    >
      {t('route', {
        protocol: quote.data?.protocol.toUpperCase() ?? (protocol === 'auto' ? t('protocolAuto') : protocol.toUpperCase()),
      })}
      <ChevronDown class="size-3.5" />
    </button>
  </div>
  <Button size="lg" {disabled} onclick={action}>
    {t(label)}
    {#if !wallet.session}<WalletIcon class="size-4.5" />{/if}
  </Button>
  <p class="mx-1 mt-3.5 flex items-center justify-center gap-2 text-center text-[10px] leading-relaxed text-muted-foreground">
    <span class="size-1.5 shrink-0 rounded-full bg-muted-foreground"></span>
    {t(POOLS.ready ? 'tradeNotice' : 'swapReadOnly')}
  </p>
  {#if trade.progress}
    <p class="mt-3 flex items-center justify-center gap-2 rounded-xl bg-highlight-soft px-3 py-2 text-center text-xs" role="status">
      {#if trade.busy}<Spinner class="size-3.5" />{/if}{t(trade.progress.stage)}
    </p>
  {/if}
  {#if trade.lastSubmitted?.hash}
    <a
      class="mt-3 flex items-center justify-center gap-1.5 text-xs text-highlight hover:underline"
      href={`${EXPLORER_URL}/tx/${trade.lastSubmitted.hash}`}
      target="_blank"
      rel="noreferrer"
    >
      {t('recentTransaction')} {shortenAddress(trade.lastSubmitted.hash)}
      <ExternalLink class="size-3.5" />
    </a>
  {/if}
  {#if wallet.error}
    <Alert.Root variant="destructive" class="mt-3"><Alert.Description>{t(wallet.error)}</Alert.Description></Alert.Root>
  {/if}
</section>
</Card.Root>

{#if selector}
  <AssetDialog selected={selector === 'from' ? fromId : toId} onSelect={selectAsset} onClose={() => (selector = undefined)} />
{/if}
{#if settingsOpen}
  <SettingsDialog
    {protocol}
    onChange={(value) => {
      changed()
      protocol = value
    }}
    onClose={() => (settingsOpen = false)}
  />
{/if}
{#if reviewOpen && review}
  {@const current = review}
  <TradeReview
    quote={current.quote}
    identity={current.identity}
    {trade}
    current={wallet.session !== undefined && wallet.getIdentity()?.revision === current.identity.revision}
    onConfirm={() => {
      executing = current.quote
      trade.execute(current.quote, current.identity)
    }}
    onClose={() => {
      const succeeded = trade.progress?.stage === 'tradeSucceeded'
      trade.cancel()
      reviewOpen = false
      // A settled swap starts the next one from a clean form; the toast keeps the receipt link.
      if (succeeded) {
        changed()
        amount = ''
      }
    }}
  />
{/if}
