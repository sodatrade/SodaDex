<script lang="ts">
  import Ellipsis from '@lucide/svelte/icons/ellipsis'
  import Search from '@lucide/svelte/icons/search'
  import WalletIcon from '@lucide/svelte/icons/wallet'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import { cn } from '$lib/utils'
  import { PAGE_PATHS, type Router } from '$lib/router.svelte'
  import type { WalletController } from '$lib/wallet.svelte'
  import { shortenAddress } from '../domain/assets'
  import { usePreferences } from '../preferences/preferences.svelte'
  import NetworkIcon from './NetworkIcon.svelte'
  import SodaMark from './SodaMark.svelte'

  let {
    router,
    wallet,
    onWallet,
    onSearch,
    onPreferences,
  }: {
    router: Router
    wallet: WalletController
    onWallet: () => void
    onSearch: () => void
    onPreferences: () => void
  } = $props()
  const { t } = usePreferences()
  const pages = $derived<{ id: keyof typeof PAGE_PATHS; name: string }[]>([
    { id: 'swap', name: t('navSwap') },
    { id: 'assets', name: t('navAssets') },
    { id: 'pools', name: t('navPools') },
  ])
</script>

<header
  class="mx-auto flex w-full max-w-[1320px] flex-wrap items-center gap-x-10 gap-y-3 px-4 py-4 sm:px-10 sm:py-7 lg:flex-nowrap"
>
  <a
    class="flex items-center gap-2 text-2xl font-semibold tracking-tight whitespace-nowrap"
    href={PAGE_PATHS.swap}
    onclick={router.link}
    aria-label={t('home')}
  >
    <SodaMark decorative class="size-8.5" />
    <span>Soda<span class="font-normal text-muted-foreground">Dex</span></span>
    <Badge variant="outline" class="mt-0.5 h-4 self-start rounded px-1.5 text-[9px] tracking-widest text-muted-foreground">TEST</Badge>
  </a>
  <nav
    aria-label={t('mainNavigation')}
    class="order-last flex w-full gap-1 rounded-2xl bg-secondary p-1 lg:order-none lg:w-auto lg:bg-transparent lg:p-0"
  >
    {#each pages as item (item.id)}
      <a
        href={PAGE_PATHS[item.id]}
        class={cn(
          'relative flex h-10 flex-1 items-center justify-center rounded-xl px-4 text-sm text-muted-foreground transition-colors hover:text-foreground lg:flex-none',
          router.page === item.id &&
            'bg-card text-foreground shadow-sm lg:bg-transparent lg:shadow-none lg:after:absolute lg:after:-bottom-1 lg:after:left-1/2 lg:after:h-0.5 lg:after:w-5 lg:after:-translate-x-1/2 lg:after:rounded lg:after:bg-primary',
        )}
        aria-current={router.page === item.id ? 'page' : undefined}
        onclick={router.link}>{item.name}</a
      >
    {/each}
  </nav>
  <div class="ml-auto flex items-center gap-1.5 sm:gap-3">
    <span class="mr-1 hidden items-center gap-2 text-[13px] whitespace-nowrap md:flex"><NetworkIcon />X Layer</span>
    <Button variant="ghost" size="icon" aria-label={t('globalSearch')} aria-haspopup="dialog" onclick={onSearch}>
      <Search />
    </Button>
    <Button
      onclick={onWallet}
      aria-label={wallet.session ? shortenAddress(wallet.session.address) : t('connectWallet')}
    >
      <WalletIcon />
      <span class="hidden sm:inline">{wallet.session ? shortenAddress(wallet.session.address) : t('headerConnect')}</span>
    </Button>
    <Button variant="ghost" size="icon" aria-label={t('preferences')} aria-haspopup="dialog" onclick={onPreferences}>
      <Ellipsis />
    </Button>
  </div>
</header>
