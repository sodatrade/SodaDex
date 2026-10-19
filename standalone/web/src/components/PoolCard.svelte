<script lang="ts">
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right'
  import Check from '@lucide/svelte/icons/check'
  import Copy from '@lucide/svelte/icons/copy'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Plus from '@lucide/svelte/icons/plus'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Progress } from '$lib/components/ui/progress'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { formatBalance } from '../domain/amount'
  import { EXPLORER_URL, shortenAddress } from '../domain/assets'
  import { usePreferences } from '../preferences/preferences.svelte'
  import type { PoolSnapshot } from '../trading/poolStats'
  import AssetIcon from './AssetIcon.svelte'

  let {
    protocol,
    fee,
    identifier,
    explorerAddress,
    snapshot,
    loading,
    swapDisabled = false,
    onSwap,
  }: {
    protocol: 'v3' | 'v4'
    fee: string
    /** V3 pool contract address, or the V4 pool id (not a contract). */
    identifier: string
    explorerAddress: string
    snapshot: PoolSnapshot | undefined
    loading: boolean
    /** True while a submitted trade is unresolved; the swap form is locked. */
    swapDisabled?: boolean
    onSwap: () => void
  } = $props()
  const preferences = usePreferences()
  const { t } = preferences
  let copied = $state(false)

  const v3 = $derived(protocol === 'v3')
  const label = $derived(protocol.toUpperCase())
  const okbValue = $derived(snapshot ? (Number(snapshot.okb) / 1e18) * snapshot.price : 0)
  const stableValue = $derived(snapshot ? Number(snapshot.stable) / 1e6 : 0)
  const okbShare = $derived(okbValue + stableValue > 0 ? (okbValue / (okbValue + stableValue)) * 100 : 50)
  const priceText = $derived(
    snapshot
      ? new Intl.NumberFormat(preferences.locale, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(
          snapshot.price,
        )
      : '',
  )

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(identifier)
      copied = true
      setTimeout(() => (copied = false), 1600)
    } catch {
      /* The explorer link remains available when clipboard access is denied. */
    }
  }
</script>

{#snippet holding(asset: 'okb' | 'wokb' | 'usdt0', symbol: string, amount: string)}
  <div class="flex items-center gap-2.5">
    <AssetIcon assetId={asset} size="sm" />
    <span class="text-xs text-muted-foreground">{symbol}</span>
    {#if loading && !snapshot}
      <Skeleton class="ml-auto h-4 w-16" />
    {:else}
      <strong class="tabular ml-auto text-sm font-medium">{amount}</strong>
    {/if}
  </div>
{/snippet}

<Card.Root
  role="article"
  aria-labelledby={`pool-${protocol}-title`}
  class="group relative gap-5 px-5 transition-colors hover:border-highlight/60 sm:px-6"
>
  <div
    class="pointer-events-none absolute -top-24 -right-24 size-56 rounded-full bg-primary/15 blur-3xl transition-opacity group-hover:opacity-100 sm:opacity-60"
    aria-hidden="true"
  ></div>
  <header class="relative flex items-start gap-3">
    <span class="flex shrink-0 -space-x-3">
      <AssetIcon assetId={v3 ? 'wokb' : 'okb'} size="lg" class="ring-4 ring-card" />
      <AssetIcon assetId="usdt0" size="lg" class="ring-4 ring-card" />
    </span>
    <div class="flex min-w-0 flex-col gap-1.5">
      <h3 id={`pool-${protocol}-title`} class="text-lg leading-tight font-medium">
        {label} · {v3 ? 'WOKB' : 'OKB'} / USD₮0 · {fee}
      </h3>
      <div class="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" class="h-6 rounded-md px-2 text-[11px]">{label}</Badge>
        <Badge variant="outline" class="h-6 rounded-md px-2 text-[11px]">{t('feeTier')} {fee}</Badge>
        <Badge class="h-6 gap-1.5 rounded-md bg-highlight-soft px-2 text-[11px] text-highlight">
          <span class="size-1.5 animate-pulse rounded-full bg-highlight"></span>{t('poolLive')}
        </Badge>
      </div>
    </div>
  </header>

  <div class="relative rounded-2xl bg-field p-4">
    <span class="text-[11px] text-muted-foreground">{t('poolSpotPrice')}</span>
    {#if loading && !snapshot}
      <Skeleton class="mt-2 h-7 w-44" />
    {:else if snapshot}
      <p class="tabular mt-1 text-2xl font-medium tracking-tight">{t('poolPriceValue', { price: priceText })}</p>
    {:else}
      <p class="mt-1 text-sm text-muted-foreground">{t('poolStatsUnavailable')}</p>
    {/if}
    <p class="mt-2 text-[11px] text-faint">{t(v3 ? 'poolV3Route' : 'poolV4Route')}</p>
  </div>

  <div class="relative flex flex-col gap-3">
    <span class="text-[11px] text-muted-foreground">{t(v3 ? 'poolReserves' : 'poolManagerReserves')}</span>
    {@render holding(v3 ? 'wokb' : 'okb', v3 ? 'WOKB' : 'OKB', snapshot ? formatBalance(snapshot.okb, 18) : '—')}
    {@render holding('usdt0', 'USD₮0', snapshot ? formatBalance(snapshot.stable, 6) : '—')}
    <!-- Value share of the OKB side; decorative, the amounts above carry the information. -->
    <Progress value={snapshot ? okbShare : 0} max={100} aria-hidden="true" class="h-1.5 bg-faint/30 *:data-[slot=progress-indicator]:bg-highlight" />
  </div>

  <dl class="relative flex items-center justify-between gap-3 border-t border-border-soft pt-4 text-xs">
    <dt class="text-muted-foreground">{t(v3 ? 'poolAddress' : 'poolId')}</dt>
    <dd class="flex min-w-0 items-center gap-1">
      {#if v3}
        <code class="tabular truncate text-[12px]">{shortenAddress(identifier)}</code>
      {:else}
        <code class="tabular truncate text-[12px]" title={identifier}>{identifier.slice(0, 10)}…{identifier.slice(-6)}</code>
      {/if}
      <Button variant="ghost" size="icon-sm" class="size-8" aria-label={t(v3 ? 'copyAddress' : 'copyPoolId')} onclick={() => void copy()}>
        {#if copied}<Check class="text-highlight" />{:else}<Copy />{/if}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        class="size-8"
        href={`${EXPLORER_URL}/address/${explorerAddress}`}
        target="_blank"
        rel="noreferrer"
        aria-label={t('explorer')}
      >
        <ExternalLink />
      </Button>
    </dd>
  </dl>

  <div class="relative grid grid-cols-2 gap-2">
    <Button onclick={onSwap} disabled={swapDisabled}>
      <ArrowLeftRight />
      {t('poolSwapWith', { protocol: label })}
    </Button>
    <Button variant="secondary" disabled>
      <Plus />
      {t('poolAddLiquidity')}
      <span class="rounded bg-background px-1.5 py-0.5 text-[10px] text-faint">{t('comingSoon')}</span>
    </Button>
  </div>
</Card.Root>
