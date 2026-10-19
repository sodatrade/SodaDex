<script lang="ts">
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Layers from '@lucide/svelte/icons/layers'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import { createQuery } from '@tanstack/svelte-query'
  import { onDestroy, onMount } from 'svelte'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import { Spinner } from '$lib/components/ui/spinner'
  import { assetPath, PAGE_PATHS, Router } from '$lib/router.svelte'
  import { getBalances, getNetworkStatus } from '$lib/rpc'
  import { cn } from '$lib/utils'
  import { WalletController } from '$lib/wallet.svelte'
  import type { WalletSession } from '$lib/wallet'
  import { announceWalletChange } from '$lib/walletNotifications'
  import { CHAIN_ID, type Protocol } from '../domain/assets'
  import { usePreferences } from '../preferences/preferences.svelte'
  import { POOLS } from '../trading/config'
  import AssetsPage from './AssetsPage.svelte'
  import Header from './Header.svelte'
  import PoolsPage from './PoolsPage.svelte'
  import PreferencesDialog from './PreferencesDialog.svelte'
  import SearchDialog from './SearchDialog.svelte'
  import SodaMark from './SodaMark.svelte'
  import SwapCard from './SwapCard.svelte'
  import WalletDialog from './WalletDialog.svelte'

  const preferences = usePreferences()
  const { t } = preferences
  const wallet = new WalletController()
  onMount(() => wallet.discover())
  onDestroy(() => wallet.destroy())

  const router = new Router()
  onMount(() => router.listen())
  let protocol = $state<Protocol>('auto')
  let tradeLocked = $state(false)
  let swapCard = $state<ReturnType<typeof SwapCard>>()
  let walletOpen = $state(false)
  let searchOpen = $state(false)
  let preferencesOpen = $state(false)
  // A fresh object per navigation, so choosing the same asset again still moves focus to it.
  const selectedAsset = $derived(router.asset ? { id: router.asset, visit: router.version } : undefined)

  $effect(() => preferences.apply())

  // A ready session needs nothing more from the wallet dialog; a wrong network keeps it open for switching.
  let previousSession: WalletSession | undefined
  $effect(() => {
    const session = wallet.session
    const before = previousSession
    previousSession = session
    if (announceWalletChange(before, session, t)) walletOpen = false
  })

  const network = createQuery(() => ({
    queryKey: ['network', CHAIN_ID],
    queryFn: getNetworkStatus,
    refetchInterval: 20_000,
    retry: 1,
  }))
  const address = $derived(wallet.session?.address)
  const correctChain = $derived(wallet.session?.chainId === CHAIN_ID)
  const balances = createQuery(() => ({
    queryKey: ['balances', CHAIN_ID, address],
    queryFn: () => getBalances(address ?? ''),
    enabled: !!address && correctChain && network.isSuccess,
    refetchInterval: 20_000,
    retry: 1,
  }))
  const currentBalances = $derived(correctChain ? balances.data : undefined)
  const balancesLoading = $derived(balances.isFetching && !balances.data)
</script>

<div class="relative isolate flex min-h-svh flex-col overflow-clip">
  <a
    class="fixed top-2 left-2 z-50 -translate-y-20 rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground focus:translate-y-0"
    href="#main">{t('skipMain')}</a
  >
  <div class="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
    <div
      class="absolute top-28 -left-56 h-[750px] w-[900px] rounded-full bg-[radial-gradient(ellipse,#a6dc3a14,transparent_65%)]"
    ></div>
    <div class="dot-field absolute inset-x-0 top-28 bottom-0 opacity-25"></div>
  </div>

  <Header
    {router}
    {wallet}
    onWallet={() => (walletOpen = true)}
    onSearch={() => (searchOpen = true)}
    onPreferences={() => (preferencesOpen = true)}
  />

  <div
    class="flex items-center justify-center gap-3 border-y border-border-soft bg-secondary/30 px-4 py-2.5 text-xs text-muted-foreground"
  >
    <Badge variant="outline" class="rounded px-1.5 text-[10px] tracking-widest text-warning">{t('testExperience')}</Badge>
    <p class="leading-relaxed">{t(POOLS.ready ? 'testTradingNotice' : 'testNotice')}</p>
  </div>

  <main id="main" tabindex="-1" class="w-full flex-1 outline-none">
    <div
      class="mx-auto grid max-w-[1136px] items-center gap-6 px-4 pt-6 pb-16 sm:gap-8 sm:px-8 sm:pt-10 sm:pb-24 lg:grid-cols-[minmax(0,1fr)_480px] lg:gap-16 lg:pt-20"
      hidden={router.page !== 'swap'}
    >
      <!-- Below lg the hero collapses to a centered heading above the swap card, as in the original layout. -->
      <section class="relative text-center lg:min-h-[460px] lg:pt-8 lg:text-left" aria-labelledby="hero-heading">
        <div
          class="flex items-center justify-center gap-2.5 text-[9px] font-medium tracking-[0.2em] text-muted-foreground sm:text-[10px] lg:justify-start"
        >
          <span class="size-1.5 bg-primary"></span>{t('builtFor')}
        </div>
        <h1
          id="hero-heading"
          class="relative z-10 mt-3 mb-2 text-[25px] leading-[1.4] font-medium tracking-tight sm:mt-4 sm:text-[34px] lg:my-6 lg:text-[clamp(38px,3.9vw,52px)]"
        >
          {t('heroFirst')}<br class="hidden lg:block" />
          <span class="text-highlight">{t('heroSecond')}</span>
        </h1>
        <p class="relative z-10 text-xs leading-relaxed text-muted-foreground lg:text-sm lg:leading-loose">
          {t('heroDescriptionFirst')}<br class="sm:hidden lg:block" />{t('heroDescriptionSecond')}
        </p>
        <div class="mt-8 hidden text-[11px] text-muted-foreground lg:flex">
          {#each [t('nativeOKB'), 'V3 + V4', t('lowFeeTest')] as item, index (item)}
            <span class={cn(index > 0 && "before:mx-3.5 before:text-border before:content-['/']")}>{item}</span>
          {/each}
        </div>
        <div class="pointer-events-none absolute -bottom-10 -left-3 hidden h-40 w-[350px] lg:block" aria-hidden="true">
          <div class="absolute top-[53px] left-[75px] h-[85px] w-[280px] -rotate-30 rounded-full border opacity-50"></div>
          <div class="absolute -top-3 left-[100px] size-[180px] -rotate-30 rounded-full border opacity-20"></div>
          <div class="absolute top-[58px] left-[286px] size-7 animate-float rounded-full bg-primary shadow-[inset_-5px_-6px_0_#1f351a3d]"></div>
          <div class="absolute top-[23px] left-[276px] size-2.5 animate-float rounded-full bg-muted-foreground opacity-50 [animation-direction:reverse]"></div>
          <div class="absolute top-2 left-[310px] size-1.5 rounded-full bg-primary opacity-50"></div>
          <span
            class="absolute top-14 left-0 text-[114px] leading-none font-medium tracking-[-10px] text-transparent opacity-75 [-webkit-text-stroke:1px_var(--border)]"
            >soda.</span
          >
        </div>
      </section>
      <div class="min-w-0">
        <div class="mx-3 mb-3.5 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span class="size-1.5 rounded-full bg-primary"></span>
          {t('flowStarts')}
          <span class="ml-auto text-[9px] tracking-widest text-faint">{t('swapIndex')}</span>
        </div>
        <SwapCard
          bind:this={swapCard}
          {wallet}
          bind:protocol
          bind:locked={tradeLocked}
          balances={currentBalances}
          {balancesLoading}
          balancesError={balances.isError || network.isError}
          onConnect={() => (walletOpen = true)}
        />
        <div class="flex items-center justify-between gap-3 px-3.5 pt-4 text-[10px] text-muted-foreground">
          <span class="flex items-center gap-1.5"><Layers class="size-3.5" />{t(POOLS.ready ? 'poolsReady' : 'deploymentPending')}</span>
          <span>{t('platformZero')}</span>
        </div>
      </div>
    </div>
    {#if router.page === 'assets'}
      <AssetsPage
        {wallet}
        balances={currentBalances}
        loading={balancesLoading}
        error={!!wallet.session && correctChain && (balances.isError || network.isError)}
        refreshing={balances.isFetching}
        selected={selectedAsset}
        onConnect={() => (walletOpen = true)}
        onRefresh={() => void balances.refetch()}
        onSwap={(id) => {
          swapCard?.chooseFrom(id)
          router.navigate(PAGE_PATHS.swap)
        }}
      />
    {:else if router.page === 'pools'}
      <PoolsPage
        locked={tradeLocked}
        onSwap={(choice) => {
          swapCard?.chooseProtocol(choice)
          router.navigate(PAGE_PATHS.swap)
        }}
      />
    {/if}
  </main>

  <footer
    class="mx-auto flex w-full max-w-[1320px] flex-col items-center justify-between gap-4 px-4 py-6 text-[10px] text-muted-foreground sm:flex-row sm:px-10"
  >
    <div class="flex flex-wrap items-center gap-2" role="status">
      <span class={cn('size-1.5 rounded-full', network.isError ? 'bg-warning' : 'bg-primary')}></span>
      <span>
        {network.isPending ? t('networkLoading') : network.isError ? t('networkUnavailable') : t('networkConnected')}
      </span>
      {#if network.data}<span class="tabular text-faint">#{network.data.block.toString()}</span>{/if}
      {#if network.isError}
        <Button variant="ghost" class="h-7 px-2 text-[10px]" onclick={() => void network.refetch()} disabled={network.isFetching}>
          {#if network.isFetching}<Spinner class="size-3.5" />{:else}<RefreshCw class="size-3.5" />{/if}{t('retry')}
        </Button>
      {/if}
    </div>
    <div class="flex items-center gap-2">
      <SodaMark decorative class="size-4.5 fill-muted-foreground" />
      <span>SodaDEX <span class="mx-1.5 text-faint">·</span> {t('footerFlow')}</span>
    </div>
    <a class="flex min-h-8 items-center gap-1.5 hover:text-foreground" href="https://github.com/sodatrade/SodaDex" target="_blank" rel="noreferrer"
      >GitHub <ExternalLink class="size-3.5" /></a
    >
  </footer>
</div>

{#if walletOpen}<WalletDialog {wallet} onClose={() => (walletOpen = false)} />{/if}
{#if preferencesOpen}<PreferencesDialog onClose={() => (preferencesOpen = false)} />{/if}
{#if searchOpen}
  <SearchDialog
    onClose={() => (searchOpen = false)}
    onPool={() => {
      router.navigate(PAGE_PATHS.pools)
      searchOpen = false
    }}
    onAsset={(id) => {
      router.navigate(assetPath(id))
      searchOpen = false
    }}
  />
{/if}
