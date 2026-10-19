<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Layers from '@lucide/svelte/icons/layers'
  import Search from '@lucide/svelte/icons/search'
  import Wallet from '@lucide/svelte/icons/wallet'
  import X from '@lucide/svelte/icons/x'
  import * as Empty from '$lib/components/ui/empty'
  import * as InputGroup from '$lib/components/ui/input-group'
  import * as Item from '$lib/components/ui/item'
  import * as ToggleGroup from '$lib/components/ui/toggle-group'
  import { isAddress } from '$lib/rpc'
  import { ASSETS, EXPLORER_URL, shortenAddress, type AssetId } from '../domain/assets'
  import { POOL_SEARCH_TEXT } from '../domain/pools'
  import { usePreferences } from '../preferences/preferences.svelte'
  import { POOLS } from '../trading/config'
  import AppDialog from './AppDialog.svelte'
  import AssetIcon from './AssetIcon.svelte'
  import { assetHint } from './labels'

  type Category = 'all' | 'tokens' | 'pools' | 'wallets'
  let {
    onClose,
    onAsset,
    onPool,
  }: { onClose: () => void; onAsset: (id: AssetId) => void; onPool: () => void } = $props()
  const { t } = usePreferences()
  let search = $state('')
  let category = $state<Category>('all')
  let input = $state<HTMLInputElement | null>(null)
  const query = $derived(search.trim().toLowerCase())
  const matches = $derived(
    ASSETS.filter((asset) => `${asset.symbol} ${asset.name} ${asset.address ?? ''}`.toLowerCase().includes(query)),
  )
  const address = $derived(isAddress(search.trim()) ? search.trim() : undefined)
  const showTokens = $derived(category === 'all' || category === 'tokens')
  const showAddress = $derived((category === 'all' || category === 'wallets') && !!address)
  const showPools = $derived(
    POOLS.ready && (category === 'all' || category === 'pools') && POOL_SEARCH_TEXT.includes(query),
  )
  const empty = $derived(!showPools && !showAddress && !(showTokens && matches.length > 0))
  const categories = $derived<{ id: Category; label: string }[]>([
    { id: 'all', label: t('searchAll') },
    { id: 'tokens', label: t('searchTokens') },
    { id: 'pools', label: t('searchPools') },
    { id: 'wallets', label: t('searchWallets') },
  ])

  function clear(): void {
    search = ''
    input?.focus()
  }
</script>

{#snippet heading(label: string)}
  <h3 class="mb-1 px-3 text-[10px] tracking-widest text-faint uppercase">{label}</h3>
{/snippet}

<AppDialog
  title={t('globalSearch')}
  description={t('globalSearchDescription')}
  {onClose}
  onEscape={() => {
    if (!search) return false
    clear()
    return true
  }}
>
  <InputGroup.Root>
    <InputGroup.Addon><Search /></InputGroup.Addon>
    <!-- svelte-ignore a11y_autofocus -->
    <InputGroup.Input
      bind:ref={input}
      autofocus
      aria-label={t('globalSearchLabel')}
      placeholder={t('globalSearchPlaceholder')}
      maxlength={100}
      bind:value={search}
    />
    {#if search}
      <InputGroup.Addon align="inline-end">
        <InputGroup.Button size="icon-xs" aria-label={t('clearSearch')} onclick={clear}><X /></InputGroup.Button>
      </InputGroup.Addon>
    {/if}
  </InputGroup.Root>
  <!-- One category is always active; an empty value from re-clicking the active pill keeps it. -->
  <ToggleGroup.Root
    type="single"
    value={category}
    onValueChange={(value) => {
      if (value) category = value as Category
    }}
    aria-label={t('searchCategories')}
    class="flex-wrap gap-1.5"
    spacing={1}
  >
    {#each categories as item (item.id)}
      <ToggleGroup.Item
        value={item.id}
        variant="outline"
        size="sm"
        class="h-8 rounded-full px-3.5 text-xs text-muted-foreground data-[state=on]:border-highlight data-[state=on]:bg-highlight-soft data-[state=on]:text-foreground"
        >{item.label}</ToggleGroup.Item
      >
    {/each}
  </ToggleGroup.Root>
  <div class="-mx-1 flex min-h-40 flex-col gap-3" aria-live="polite">
    {#if showTokens && matches.length > 0}
      <section aria-label={t('knownAssets')}>
        {@render heading(t('knownAssets'))}
        <Item.Group class="gap-1">
          {#each matches as asset (asset.id)}
            <Item.Root>
              {#snippet child({ props })}
                <button {...props} onclick={() => onAsset(asset.id)}>
                  <Item.Media><AssetIcon assetId={asset.id} /></Item.Media>
                  <Item.Content>
                    <Item.Title class="text-[15px] font-medium">{asset.symbol}</Item.Title>
                    <Item.Description class="text-[11px]">{t(assetHint(asset.id))}</Item.Description>
                  </Item.Content>
                  <Item.Actions><ChevronRight class="size-4 text-muted-foreground" /></Item.Actions>
                </button>
              {/snippet}
            </Item.Root>
          {/each}
        </Item.Group>
      </section>
    {/if}
    {#if showPools}
      <section aria-label={t('searchPools')}>
        {@render heading(t('searchPools'))}
        <Item.Root>
          {#snippet child({ props })}
            <button {...props} onclick={onPool}>
              <Item.Media class="size-10 rounded-full bg-highlight-soft text-highlight"><Layers class="size-5" /></Item.Media>
              <Item.Content>
                <Item.Title class="text-[15px] font-medium">OKB / USD₮0 · V3 + V4</Item.Title>
                <Item.Description class="text-[11px]">{t('poolsReady')}</Item.Description>
              </Item.Content>
              <Item.Actions><ChevronRight class="size-4 text-muted-foreground" /></Item.Actions>
            </button>
          {/snippet}
        </Item.Root>
      </section>
    {/if}
    {#if showAddress && address}
      <section aria-label={t('publicAddress')}>
        {@render heading(t('publicAddress'))}
        <Item.Root>
          {#snippet child({ props })}
            <a
              {...props}
              href={`${EXPLORER_URL}/address/${address}`}
              target="_blank"
              rel="noreferrer"
              aria-label={t('addressResult', { address })}
            >
              <Item.Media class="size-10 rounded-full bg-secondary"><Wallet class="size-5" /></Item.Media>
              <Item.Content class="min-w-0">
                <Item.Title class="text-[15px] font-medium">{shortenAddress(address)}</Item.Title>
                <Item.Description class="truncate text-[11px]">{address}</Item.Description>
              </Item.Content>
              <Item.Actions><ExternalLink class="size-4 text-muted-foreground" /></Item.Actions>
            </a>
          {/snippet}
        </Item.Root>
        <p class="mt-2 px-3 text-[11px] text-muted-foreground">{t('searchAddressNote')}</p>
      </section>
    {/if}
    {#if empty}
      <Empty.Root class="py-8">
        <Empty.Header>
          <Empty.Title class="text-xs font-normal text-muted-foreground">
            {category === 'pools'
              ? t(POOLS.ready ? 'searchNoResults' : 'searchNoPools')
              : category === 'wallets'
                ? t('searchWalletHint')
                : t('searchNoResults')}
          </Empty.Title>
          {#if category !== 'pools' && category !== 'wallets'}
            <Empty.Description class="text-xs">{t('searchNoResultsHint')}</Empty.Description>
          {/if}
        </Empty.Header>
      </Empty.Root>
    {/if}
  </div>
</AppDialog>
