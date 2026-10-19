<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import { Button } from '$lib/components/ui/button'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import { cn } from '$lib/utils'
  import { getAsset, type AssetId } from '../domain/assets'
  import { usePreferences } from '../preferences/preferences.svelte'
  import AssetIcon from './AssetIcon.svelte'

  let {
    id,
    pay = false,
    amount,
    exactAmount,
    onAmount,
    onSelect,
    balance,
    error = false,
    disabled = false,
    hint,
  }: {
    id: AssetId
    pay?: boolean
    amount: string
    exactAmount?: string
    onAmount?: (value: string) => void
    onSelect: () => void
    balance: string
    error?: boolean
    disabled?: boolean
    hint: string
  } = $props()
  const { t } = usePreferences()
  const asset = $derived(getAsset(id))
</script>

<div
  class={cn(
    'rounded-2xl border p-4 transition-colors',
    pay ? 'border-border-soft bg-field focus-within:border-highlight' : 'border-transparent bg-secondary',
    error && 'border-destructive focus-within:border-destructive',
  )}
>
  <div class="mb-4 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
    {#if pay}<label for="sell-amount">{t('pay')}</label>{:else}<span>{t('receive')}</span>{/if}
    <span class="tabular text-[10px]">{balance}</span>
  </div>
  <div class="flex min-h-11 items-center gap-3">
    {#if pay}
      <input
        id="sell-amount"
        class="tabular w-full min-w-0 flex-1 bg-transparent p-0 text-4xl leading-tight tracking-tight text-foreground outline-none placeholder:text-faint/70 disabled:opacity-60"
        inputmode="decimal"
        autocomplete="off"
        placeholder="0"
        value={amount}
        oninput={(event) => onAmount?.(event.currentTarget.value.slice(0, 100))}
        aria-invalid={error}
        aria-describedby={error ? 'amount-error' : undefined}
        {disabled}
      />
    {:else}
      <Tooltip.Root disabled={!exactAmount || exactAmount === amount}>
        <Tooltip.Trigger class="min-w-0 flex-1 text-left">
          {#snippet child({ props })}
            <output
              {...props}
              class="tabular min-w-0 flex-1 truncate text-[34px] leading-tight tracking-tight text-faint"
              aria-label={t('receiveAmount')}>{amount}</output
            >
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content class="tabular">{exactAmount}</Tooltip.Content>
      </Tooltip.Root>
    {/if}
    <Button
      variant="outline"
      class="h-11 shrink-0 gap-2 rounded-full bg-card py-1.5 pr-2.5 pl-1.5 hover:bg-accent"
      onclick={onSelect}
      {disabled}
      aria-label={t(pay ? 'choosePay' : 'chooseReceive', { symbol: asset.symbol })}
    >
      <AssetIcon assetId={id} size="sm" />
      <strong class="text-[15px] font-medium">{asset.symbol}</strong>
      <ChevronDown class="text-muted-foreground" />
    </Button>
  </div>
  <span class="mt-3 block text-[10px] text-faint">{hint}</span>
</div>
