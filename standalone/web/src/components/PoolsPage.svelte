<script lang="ts">
  import Info from '@lucide/svelte/icons/info'
  import Layers from '@lucide/svelte/icons/layers'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import { createQuery } from '@tanstack/svelte-query'
  import plan from '../../../../deployments/xlayer-test/active.json'
  import * as Alert from '$lib/components/ui/alert'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import * as Empty from '$lib/components/ui/empty'
  import { Spinner } from '$lib/components/ui/spinner'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import type { RouteProtocol } from '../trading/types'
  import { usePreferences } from '../preferences/preferences.svelte'
  import { POOLS, V4_POOL_ID } from '../trading/config'
  import { poolStatsQuery } from '../trading/poolStats'
  import NetworkIcon from './NetworkIcon.svelte'
  import PageHeading from './PageHeading.svelte'
  import PoolCard from './PoolCard.svelte'

  let { onSwap, locked = false }: { onSwap: (protocol: RouteProtocol) => void; locked?: boolean } = $props()
  const preferences = usePreferences()
  const { t } = preferences
  const stats = createQuery(poolStatsQuery)
  const totalValue = $derived.by(() => {
    const data = stats.data
    if (!data) return undefined
    const value = (s: typeof data.v3): number => (Number(s.okb) / 1e18) * s.price + Number(s.stable) / 1e6
    return new Intl.NumberFormat(preferences.locale, { maximumFractionDigits: 4 }).format(value(data.v3) + value(data.v4))
  })
  const loading = $derived(stats.isPending && POOLS.ready)
</script>

<section class="mx-auto w-full max-w-[1136px] px-4 pt-10 pb-24 sm:px-8 sm:pt-16" aria-labelledby="pools-title">
  <PageHeading
    eyebrow={t('poolsEyebrow')}
    id="pools-title"
    title={t('poolsTitle')}
    description={t(POOLS.ready ? 'poolReadyNote' : 'poolsDescription')}
  />

  <div class="mb-6 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
    {#snippet stat(label: string)}
      <span class="text-[11px] text-muted-foreground">{label}</span>
    {/snippet}
    <Card.Root size="sm" class="gap-2 rounded-2xl px-4 shadow-none sm:[--card-spacing:--spacing(4)]">
      {@render stat(t('poolsOpenCount'))}
      <strong class="tabular text-2xl font-medium">{POOLS.ready ? 2 : 0}</strong>
    </Card.Root>
    <Card.Root size="sm" class="gap-2 rounded-2xl px-4 shadow-none sm:[--card-spacing:--spacing(4)]">
      {@render stat(t('poolsTotalValue'))}
      {#if loading}
        <Skeleton class="h-8 w-24" />
      {:else}
        <Tooltip.Root>
          <Tooltip.Trigger class="w-fit text-left">
            <strong class="tabular text-2xl font-medium">
              {totalValue ?? '—'}<span class="ml-1 text-xs font-normal text-muted-foreground">USD₮0</span>
            </strong>
          </Tooltip.Trigger>
          <Tooltip.Content>{t('poolsValueNote')}</Tooltip.Content>
        </Tooltip.Root>
      {/if}
    </Card.Root>
    <Card.Root size="sm" class="gap-2 rounded-2xl px-4 shadow-none sm:[--card-spacing:--spacing(4)]">
      {@render stat(t('platformProtocolFee'))}
      <strong class="tabular text-2xl font-medium">0%</strong>
    </Card.Root>
    <Card.Root size="sm" class="gap-2 rounded-2xl px-4 shadow-none sm:[--card-spacing:--spacing(4)]">
      {@render stat(t('networkLabel'))}
      <strong class="flex items-center gap-2 text-2xl font-medium"><NetworkIcon />X Layer</strong>
    </Card.Root>
  </div>

  {#if POOLS.ready && POOLS.v3Address}
    {#if stats.isError}
      <Alert.Root variant="warning" class="mb-4">
        <TriangleAlert />
        <Alert.Description class="text-xs">{t('poolStatsUnavailable')}</Alert.Description>
        <Alert.Action>
          <Button variant="ghost" size="icon-sm" aria-label={t('retry')} onclick={() => void stats.refetch()} disabled={stats.isFetching}>
            {#if stats.isFetching}<Spinner />{:else}<RefreshCw />{/if}
          </Button>
        </Alert.Action>
      </Alert.Root>
    {/if}
    <div class="grid gap-4 md:grid-cols-2">
      <PoolCard
        protocol="v3"
        fee="0.01%"
        identifier={POOLS.v3Address}
        explorerAddress={POOLS.v3Address}
        snapshot={stats.data?.v3}
        {loading}
        swapDisabled={locked}
        onSwap={() => onSwap('v3')}
      />
      <PoolCard
        protocol="v4"
        fee="0%"
        identifier={V4_POOL_ID}
        explorerAddress={plan.contracts.v4PoolManager}
        snapshot={stats.data?.v4}
        {loading}
        swapDisabled={locked}
        onSwap={() => onSwap('v4')}
      />
    </div>
    <div class="mt-5 flex flex-col gap-2 px-2 text-[11px] leading-relaxed text-muted-foreground">
      <p class="flex items-start gap-2"><Info class="mt-0.5 size-3.5 shrink-0" />{t('poolDataNote')}</p>
      <p class="pl-5.5">{t('poolV4ManagerNote')}</p>
    </div>
  {:else}
    <Empty.Root class="rounded-[28px] border border-dashed bg-card py-16">
      <Empty.Header>
        <Empty.Media class="size-16 rounded-2xl bg-highlight-soft text-highlight"><Layers class="size-8" /></Empty.Media>
        <Empty.Title class="text-lg font-medium" role="heading" aria-level={2}>{t('poolsEmptyTitle')}</Empty.Title>
        <Empty.Description class="max-w-md">{t('poolsEmptyDescription')}</Empty.Description>
      </Empty.Header>
    </Empty.Root>
  {/if}
</section>
