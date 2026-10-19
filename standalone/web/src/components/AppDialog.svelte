<script lang="ts">
  import type { Snippet } from 'svelte'
  import * as Dialog from '$lib/components/ui/dialog'
  import { usePreferences } from '../preferences/preferences.svelte'

  let {
    title,
    description,
    onClose,
    onEscape,
    children,
  }: {
    title: string
    description?: string
    onClose: () => void
    /** Return true to consume Escape (for example to clear a search) instead of closing. */
    onEscape?: () => boolean
    children: Snippet
  } = $props()
  const { t } = usePreferences()
</script>

<Dialog.Root
  open
  onOpenChange={(open) => {
    if (!open) onClose()
  }}
>
  <Dialog.Content
    closeLabel={t('closeDialog')}
    onEscapeKeydown={(event) => {
      if (onEscape?.()) event.preventDefault()
    }}
  >
    <Dialog.Header class="pr-10">
      <Dialog.Title class="text-lg font-medium">{title}</Dialog.Title>
      {#if description}
        <Dialog.Description class="text-xs leading-relaxed">{description}</Dialog.Description>
      {/if}
    </Dialog.Header>
    {@render children()}
  </Dialog.Content>
</Dialog.Root>
