<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import { formatUnits } from 'viem'
  import * as Alert from '$lib/components/ui/alert'
  import { Button } from '$lib/components/ui/button'
  import { Spinner } from '$lib/components/ui/spinner'
  import { CHAIN_ID, EXPLORER_URL, getAsset, shortenAddress } from '../domain/assets'
  import { usePreferences } from '../preferences/preferences.svelte'
  import { CONTRACTS } from '../trading/config'
  import type { TradeController } from '../trading/trade.svelte'
  import type { Quote, TradeIdentity } from '../trading/types'
  import AppDialog from './AppDialog.svelte'
  import AssetIcon from './AssetIcon.svelte'
  import DialogNote from './DialogNote.svelte'

  let {
    quote,
    identity,
    trade,
    current,
    onConfirm,
    onClose,
  }: {
    quote: Quote
    identity: TradeIdentity
    trade: TradeController
    current: boolean
    onConfirm: () => void
    onClose: () => void
  } = $props()
  const { t } = usePreferences()
  const from = $derived(getAsset(quote.from))
  const to = $derived(getAsset(quote.to))
  const done = $derived(trade.progress?.stage === 'tradeSucceeded')
</script>

<AppDialog title={t('reviewSwap')} description={t('tradeNotice')} {onClose}>
  <div class="flex items-center justify-between gap-3 rounded-2xl border border-border-soft bg-field p-4">
    <div class="flex min-w-0 items-center gap-2.5">
      <AssetIcon assetId={from.id} size="sm" />
      <strong class="tabular truncate text-[15px] font-medium">{formatUnits(quote.amount, from.decimals)} {from.symbol}</strong>
    </div>
    <ArrowRight class="size-4 shrink-0 text-muted-foreground" />
    <div class="flex min-w-0 items-center gap-2.5">
      <AssetIcon assetId={to.id} size="sm" />
      <strong class="tabular truncate text-[15px] font-medium">{formatUnits(quote.amountOut, to.decimals)} {to.symbol}</strong>
    </div>
  </div>
  <dl class="flex flex-col gap-2.5 text-xs">
    {#snippet item(label: string, value: string, href?: string)}
      <div class="flex items-center justify-between gap-3">
        <dt class="text-muted-foreground">{label}</dt>
        <dd class="tabular text-right">
          {#if href}<a class="text-highlight hover:underline" {href} target="_blank" rel="noreferrer">{value}</a>{:else}{value}{/if}
        </dd>
      </div>
    {/snippet}
    {@render item(t('minimumReceived'), `${formatUnits(quote.minimumOut, to.decimals)} ${to.symbol}`)}
    {@render item(t('slippageTolerance'), '0.5%')}
    {@render item(t('protocolPreference'), `${quote.protocol.toUpperCase()} · ${quote.protocol === 'v3' ? '0.01%' : '0%'}`)}
    {@render item(t('platformProtocolFee'), '0%')}
    {@render item(t('networkLabel'), `X Layer · ${CHAIN_ID}`)}
    {@render item(t('recipient'), shortenAddress(identity.address), `${EXPLORER_URL}/address/${identity.address}`)}
    {@render item(t('swapRouter'), shortenAddress(CONTRACTS.router), `${EXPLORER_URL}/address/${CONTRACTS.router}`)}
  </dl>
  <DialogNote>{t(quote.from === 'usdt0' ? 'boundedApprovalNote' : 'nativeRouteNote')}</DialogNote>
  <p class="-mt-2 text-[11px] leading-relaxed text-muted-foreground">{t('deadlineNote')}</p>
  {#if trade.progress}
    <p class="flex items-center gap-2 rounded-xl bg-highlight-soft px-3 py-2.5 text-xs text-foreground" role="status">
      {#if trade.busy}<Spinner class="size-3.5" />{/if}{t(trade.progress.stage)}
    </p>
  {/if}
  {#if trade.progress?.hash}
    <a
      class="inline-flex items-center gap-1.5 text-xs text-highlight hover:underline"
      href={`${EXPLORER_URL}/tx/${trade.progress.hash}`}
      target="_blank"
      rel="noreferrer">{t('viewTransaction')} <ExternalLink class="size-3.5" /></a
    >
  {/if}
  {#if (trade.error || !current) && !done}
    <Alert.Root variant="destructive"><Alert.Description>{t(trade.error ?? 'tradeIdentityChanged')}</Alert.Description></Alert.Root>
  {/if}
  {#if trade.unresolved && !trade.busy}
    <Button size="lg" variant="secondary" onclick={() => void trade.recheck()} disabled={trade.checking}>
      {t(trade.checking ? 'reading' : 'checkReceipt')}
    </Button>
  {:else}
    <Button
      size="lg"
      onclick={done ? onClose : onConfirm}
      disabled={!done && (!current || trade.busy || !!trade.error)}
    >
      {#if trade.busy}<Spinner />{/if}
      {t(done ? 'closeDialog' : trade.busy ? 'waitingConfirmation' : 'confirmSwap')}
    </Button>
  {/if}
</AppDialog>
