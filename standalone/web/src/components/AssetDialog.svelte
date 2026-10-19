<script lang="ts">
  import Check from '@lucide/svelte/icons/check'
  import Search from '@lucide/svelte/icons/search'
  import * as Empty from '$lib/components/ui/empty'
  import * as InputGroup from '$lib/components/ui/input-group'
  import * as Item from '$lib/components/ui/item'
  import { ASSETS, type AssetId } from '../domain/assets'
  import { usePreferences } from '../preferences/preferences.svelte'
  import AppDialog from './AppDialog.svelte'
  import AssetIcon from './AssetIcon.svelte'
  import DialogNote from './DialogNote.svelte'
  import { assetHint } from './labels'

  let { selected, onSelect, onClose }: { selected: AssetId; onSelect: (id: AssetId) => void; onClose: () => void } =
    $props()
  const { t } = usePreferences()
  let search = $state('')
  const assets = $derived(
    ASSETS.filter((asset) =>
      `${asset.symbol} ${asset.name} ${asset.address ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  )
</script>

<AppDialog title={t('chooseAsset')} description={t('verifiedAssets')} {onClose}>
  <InputGroup.Root>
    <InputGroup.Addon><Search /></InputGroup.Addon>
    <!-- svelte-ignore a11y_autofocus -->
    <InputGroup.Input
      autofocus
      aria-label={t('assetSearchLabel')}
      placeholder={t('assetSearchPlaceholder')}
      bind:value={search}
    />
  </InputGroup.Root>
  <Item.Group class="-mx-1 gap-1">
    {#each assets as asset (asset.id)}
      <Item.Root class="aria-pressed:bg-highlight-soft/60">
        {#snippet child({ props })}
          <button {...props} aria-pressed={asset.id === selected} onclick={() => onSelect(asset.id)}>
            <Item.Media><AssetIcon assetId={asset.id} /></Item.Media>
            <Item.Content>
              <Item.Title class="text-[15px] font-medium">{asset.symbol}</Item.Title>
              <Item.Description class="text-[11px]">{t(assetHint(asset.id))}</Item.Description>
            </Item.Content>
            {#if asset.id === selected}<Item.Actions><Check class="size-5 text-highlight" /></Item.Actions>{/if}
          </button>
        {/snippet}
      </Item.Root>
    {:else}
      <Empty.Root class="py-8"><Empty.Description>{t('noAssets')}</Empty.Description></Empty.Root>
    {/each}
  </Item.Group>
  <DialogNote>{t('assetExplanation')}</DialogNote>
</AppDialog>
