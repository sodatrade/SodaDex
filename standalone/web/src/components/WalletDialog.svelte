<script lang="ts">
  import Check from '@lucide/svelte/icons/check'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import Copy from '@lucide/svelte/icons/copy'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import Wallet from '@lucide/svelte/icons/wallet'
  import * as Alert from '$lib/components/ui/alert'
  import { Button } from '$lib/components/ui/button'
  import * as Empty from '$lib/components/ui/empty'
  import * as Item from '$lib/components/ui/item'
  import { Spinner } from '$lib/components/ui/spinner'
  import type { WalletController } from '$lib/wallet.svelte'
  import { CHAIN_ID, EXPLORER_URL, shortenAddress } from '../domain/assets'
  import { usePreferences } from '../preferences/preferences.svelte'
  import AppDialog from './AppDialog.svelte'
  import DialogNote from './DialogNote.svelte'

  let { wallet, onClose }: { wallet: WalletController; onClose: () => void } = $props()
  const { t } = usePreferences()
  let copied = $state(false)
  let copyError = $state(false)
  const session = $derived(wallet.session)
  const busy = $derived(wallet.status !== 'idle')

  async function copyAddress(): Promise<void> {
    if (!session) return
    try {
      await navigator.clipboard.writeText(session.address)
      copied = true
      copyError = false
    } catch {
      copyError = true
    }
  }
</script>

<AppDialog
  title={session ? t('walletTitle') : t('connectWallet')}
  description={session ? (session.id === 'injected' ? t('browserWallet') : session.name) : t('walletConnectDescription')}
  {onClose}
>
  {#if session}
    <Empty.Root class="gap-3 rounded-2xl border bg-field px-4 py-6">
      <Empty.Header>
        <Empty.Media class="size-14 rounded-full bg-highlight-soft text-highlight"><Wallet class="size-6.5" /></Empty.Media>
        <Empty.Title class="tabular text-lg font-medium">{shortenAddress(session.address)}</Empty.Title>
        <Empty.Description class="text-xs">
          {session.chainId === CHAIN_ID ? t('walletConnected') : t('walletNetwork', { chainId: session.chainId })}
        </Empty.Description>
      </Empty.Header>
      <Empty.Content class="grid w-full grid-cols-2 gap-2">
        <Button variant="secondary" onclick={() => void copyAddress()}>
          {#if copied}<Check />{:else}<Copy />{/if}
          {copied ? t('copied') : t('copyAddress')}
        </Button>
        <Button variant="secondary" href={`${EXPLORER_URL}/address/${session.address}`} target="_blank" rel="noreferrer">
          <ExternalLink />
          {t('explorer')}
        </Button>
      </Empty.Content>
    </Empty.Root>
    <p class="sr-only" role="status">{copied ? t('addressCopied') : ''}</p>
    {#if copyError}
      <Alert.Root variant="destructive"><Alert.Description>{t('copyFailed')}</Alert.Description></Alert.Root>
    {/if}
    {#if session.chainId !== CHAIN_ID}
      <Button disabled={busy} onclick={() => void wallet.switchChain()}>
        {#if wallet.status === 'switching'}<Spinner />{/if}
        {wallet.status === 'switching' ? t('waitingWallet') : t('switchNetwork')}
      </Button>
    {/if}
    <Button
      variant="ghost"
      disabled={busy}
      onclick={() => {
        wallet.disconnect()
        onClose()
      }}
    >
      {t('disconnect')}
    </Button>
  {:else}
    <Item.Group class="gap-2">
      {#each wallet.options as option (option.id)}
        <Item.Root variant="outline" class="min-h-16 bg-field hover:border-highlight disabled:opacity-60">
          {#snippet child({ props })}
            <button {...props} disabled={busy} onclick={() => void wallet.connect(option)}>
              <Item.Media class="size-10 rounded-xl bg-highlight-soft text-highlight"><Wallet class="size-5" /></Item.Media>
              <Item.Content>
                <Item.Title class="text-sm font-medium">{option.id === 'injected' ? t('browserWallet') : option.name}</Item.Title>
              </Item.Content>
              <Item.Actions class="text-xs text-muted-foreground">
                {#if busy}<Spinner class="size-3.5" />{/if}
                {busy ? t('waitingConfirmation') : t('connect')}
                <ChevronRight class="size-4" />
              </Item.Actions>
            </button>
          {/snippet}
        </Item.Root>
      {:else}
        <Empty.Root class="rounded-2xl border border-dashed py-8">
          <Empty.Header>
            <Empty.Media variant="icon"><Wallet /></Empty.Media>
            <Empty.Title class="text-sm" role="heading" aria-level={3}>{t('walletEmptyTitle')}</Empty.Title>
            <Empty.Description class="text-xs">{t('walletEmptyDescription')}</Empty.Description>
          </Empty.Header>
        </Empty.Root>
      {/each}
    </Item.Group>
  {/if}
  {#if wallet.error}
    <Alert.Root variant="destructive"><Alert.Description>{t(wallet.error)}</Alert.Description></Alert.Root>
  {/if}
  <DialogNote>{t('walletReadOnly')}</DialogNote>
</AppDialog>
