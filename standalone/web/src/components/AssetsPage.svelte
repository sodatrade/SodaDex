<script lang="ts">
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right'
  import Check from '@lucide/svelte/icons/check'
  import Copy from '@lucide/svelte/icons/copy'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Info from '@lucide/svelte/icons/info'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import WalletIcon from '@lucide/svelte/icons/wallet'
  import { createQuery } from '@tanstack/svelte-query'
  import { tick } from 'svelte'
  import * as Alert from '$lib/components/ui/alert'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Spinner } from '$lib/components/ui/spinner'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { cn } from '$lib/utils'
  import type { WalletController } from '$lib/wallet.svelte'
  import { formatBalance } from '../domain/amount'
  import { ASSETS, CHAIN_ID, EXPLORER_URL, shortenAddress, type Asset, type AssetId } from '../domain/assets'
  import { usePreferences } from '../preferences/preferences.svelte'
  import { poolStatsQuery } from '../trading/poolStats'
  import AssetIcon from './AssetIcon.svelte'
  import PageHeading from './PageHeading.svelte'

  let {
    wallet,
    balances,
    loading,
    error,
    refreshing,
    selected,
    onConnect,
    onRefresh,
    onSwap,
  }: {
    wallet: WalletController
    balances: Record<AssetId, bigint> | undefined
    loading: boolean
    error: boolean
    refreshing: boolean
    selected?: { id: AssetId; visit: number }
    onConnect: () => void
    onRefresh: () => void
    onSwap: (id: AssetId) => void
  } = $props()
  const preferences = usePreferences()
  const { t } = preferences
  const stats = createQuery(poolStatsQuery)
  let copied = $state(false)

  const session = $derived(wallet.session)
  const onChain = $derived(session?.chainId === CHAIN_ID)
  // OKB and WOKB are 1:1; USD₮0 is the quote unit itself.
  const okbPrice = $derived(stats.data?.v4.price)
  const priceOf = (asset: Asset): number | undefined => (asset.id === 'usdt0' ? 1 : okbPrice)
  const valueOf = (asset: Asset): number | undefined => {
    const price = priceOf(asset)
    const units = balances?.[asset.id]
    return price === undefined || units === undefined ? undefined : (Number(units) / 10 ** asset.decimals) * price
  }
  const total = $derived.by(() => {
    if (!balances || okbPrice === undefined) return undefined
    return ASSETS.reduce((sum, asset) => sum + (valueOf(asset) ?? 0), 0)
  })
  const number = (value: number, digits = 2): string =>
    new Intl.NumberFormat(preferences.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  const tradable = (id: AssetId): boolean => id === 'okb' || id === 'usdt0'

  $effect(() => {
    const id = selected?.id
    void selected?.visit
    if (id) void tick().then(() => document.getElementById(`asset-${id}`)?.focus())
  })

  async function copyAddress(): Promise<void> {
    if (!session) return
    try {
      await navigator.clipboard.writeText(session.address)
      copied = true
      setTimeout(() => (copied = false), 1600)
    } catch {
      /* The explorer link still exposes the full address. */
    }
  }
</script>

<section class="mx-auto w-full max-w-[1136px] px-4 pt-10 pb-24 sm:px-8 sm:pt-16" aria-labelledby="assets-title">
  <PageHeading eyebrow={t('assetsEyebrow')} id="assets-title" title={t('assetsTitle')} description={t('assetsDescription')} />

  <!-- Overview: what the visitor can do next depends on the wallet state. -->
  <Card.Root class="mb-4 block px-5 sm:px-6">
    {#if !session || !onChain}
      <div class="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <span
          class={cn(
            'grid size-12 shrink-0 place-items-center rounded-2xl',
            session ? 'bg-warning-soft text-warning' : 'bg-highlight-soft text-highlight',
          )}
        >
          {#if session}<TriangleAlert class="size-6" />{:else}<WalletIcon class="size-6" />{/if}
        </span>
        <div class="flex flex-col gap-1">
          <h2 class="text-base font-medium">{session ? t('switchNetwork') : t('assetsConnectTitle')}</h2>
          <p class="text-xs leading-relaxed text-muted-foreground">
            {session ? t('assetsWrongNetwork') : t('assetsConnectBody')}
          </p>
        </div>
        <Button
          class="w-full sm:ml-auto sm:w-auto"
          disabled={wallet.status !== 'idle'}
          onclick={() => (session ? void wallet.switchChain() : onConnect())}
        >
          {#if !session}<WalletIcon />{/if}
          {wallet.status !== 'idle' ? t('waitingWallet') : session ? t('switchNetwork') : t('connectWallet')}
        </Button>
      </div>
    {:else}
      <div class="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div class="flex flex-col gap-1.5">
          <span class="text-[11px] text-muted-foreground">{t('assetsTotalValue')}</span>
          {#if total === undefined && (loading || stats.isPending)}
            <Skeleton class="h-9 w-40" />
          {:else}
            <strong class="tabular text-3xl font-medium tracking-tight">
              {total === undefined ? '—' : `≈ ${number(total)}`}<span class="ml-1.5 text-sm font-normal text-muted-foreground"
                >USD₮0</span
              >
            </strong>
          {/if}
          <span class="text-[11px] text-faint">{t('assetsValueBasis')}</span>
        </div>
        <div class="flex items-center gap-1 self-start rounded-full border bg-field py-1 pr-1 pl-3 sm:self-auto">
          <span class="size-1.5 rounded-full bg-primary"></span>
          <code class="tabular mx-1 text-xs">{shortenAddress(session.address)}</code>
          <Button variant="ghost" size="icon-sm" class="size-8" aria-label={t('copyAddress')} onclick={() => void copyAddress()}>
            {#if copied}<Check class="text-highlight" />{:else}<Copy />{/if}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-8"
            href={`${EXPLORER_URL}/address/${session.address}`}
            target="_blank"
            rel="noreferrer"
            aria-label={t('explorer')}
          >
            <ExternalLink />
          </Button>
          <Button variant="ghost" size="icon-sm" class="size-8" aria-label={t('refreshBalances')} onclick={onRefresh} disabled={refreshing}>
            {#if refreshing}<Spinner />{:else}<RefreshCw />{/if}
          </Button>
        </div>
      </div>
    {/if}
  </Card.Root>

  {#if error}
    <Alert.Root variant="warning" class="mb-4">
      <TriangleAlert />
      <Alert.Description class="text-xs">{t('balanceUnavailable')}</Alert.Description>
      <Alert.Action>
        <Button variant="ghost" class="h-8 px-3 text-xs" onclick={onRefresh} disabled={refreshing}>
          {#if refreshing}<Spinner />{/if}{t('retry')}
        </Button>
      </Alert.Action>
    </Alert.Root>
  {/if}

  <Card.Root class="block gap-0 py-0 sm:py-0">
    <div
      class="hidden grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr_7.5rem] items-center gap-4 border-b px-6 py-3.5 text-[11px] text-muted-foreground md:grid"
    >
      <span>{t('navAssets')}</span>
      <span>{t('referencePrice')} · USD₮0</span>
      <span class="text-right">{t('walletBalance')}</span>
      <span class="text-right">{t('assetValue')} · USD₮0</span>
      <span></span>
    </div>
    {#each ASSETS as asset (asset.id)}
      {@const price = priceOf(asset)}
      {@const value = valueOf(asset)}
      {@const units = balances?.[asset.id]}
      <div
        role="group"
        id={`asset-${asset.id}`}
        tabindex="-1"
        aria-label={asset.id === selected?.id ? t('selectedAsset', { symbol: asset.symbol }) : asset.symbol}
        class={cn(
          'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 border-b px-4 py-4 outline-none transition-colors last:border-b-0 sm:px-6 md:grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr_7.5rem]',
          asset.id === selected?.id && 'bg-highlight-soft/50',
        )}
      >
        <div class="flex min-w-0 items-center gap-3">
          <AssetIcon assetId={asset.id} />
          <div class="flex min-w-0 flex-col gap-0.5">
            <strong class="text-[15px] font-medium">{asset.symbol}</strong>
            {#if asset.address}
              <a
                class="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-highlight"
                href={`${EXPLORER_URL}/token/${asset.address}`}
                target="_blank"
                rel="noreferrer">{shortenAddress(asset.address)} <ExternalLink class="size-3" /></a
              >
            {:else}
              <span class="text-[11px] text-faint">{t('nativeAsset')}</span>
            {/if}
          </div>
        </div>

        <!-- Price: its own column from md; on phones a second row under the name, beside the swap action. -->
        <span class="tabular order-3 text-xs text-muted-foreground md:order-none md:text-sm">
          <span class="md:hidden">{t('referencePrice')} </span>
          {#if price === undefined && stats.isPending}
            <Skeleton class="inline-block h-4 w-16 align-middle" />
          {:else}
            {price === undefined ? '—' : number(price)}
          {/if}
        </span>

        <div class="flex flex-col items-end gap-1 md:contents">
          <div class="flex flex-col items-end md:text-right">
            {#if loading}
              <Skeleton class="h-4 w-20" />
              <span class="sr-only">{t('reading')}</span>
            {:else}
              <strong class={cn('tabular text-[15px] font-medium', units === 0n && 'text-muted-foreground')}>
                {!session || !onChain ? '—' : error ? t('unavailable') : units === undefined ? '—' : formatBalance(units, asset.decimals)}
              </strong>
            {/if}
            <span class="text-[11px] text-faint md:hidden">{asset.symbol}</span>
          </div>
          <span class="tabular text-xs text-muted-foreground md:text-right md:text-sm">
            {value === undefined || !onChain ? '' : `≈ ${number(value)}`}
          </span>
        </div>

        <div class="order-last flex justify-end md:order-none">
          {#if tradable(asset.id)}
            <Button
              variant="secondary"
              class="h-9 rounded-xl px-3 text-xs"
              aria-label={t('swapAsset', { symbol: asset.symbol })}
              onclick={() => onSwap(asset.id)}
            >
              <ArrowLeftRight />
              {t('navSwap')}
            </Button>
          {:else}
            <span class="text-[11px] text-faint">{t('assetNoRoute')}</span>
          {/if}
        </div>
      </div>
    {/each}
  </Card.Root>

  <div class="mt-5 flex flex-col gap-2 px-2 text-[11px] leading-relaxed text-muted-foreground">
    <p class="flex items-start gap-2">
      <Info class="mt-0.5 size-3.5 shrink-0" />{t('assetsPriceNote', { currency: preferences.currency })}
    </p>
    <p class="pl-5.5">{t('assetPageNote')}</p>
  </div>
</section>
