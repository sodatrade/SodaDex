<script lang="ts">
  import * as Field from '$lib/components/ui/field'
  import * as Item from '$lib/components/ui/item'
  import * as RadioGroup from '$lib/components/ui/radio-group'
  import type { Protocol } from '../domain/assets'
  import { usePreferences } from '../preferences/preferences.svelte'
  import AppDialog from './AppDialog.svelte'
  import DialogNote from './DialogNote.svelte'

  let {
    protocol,
    onChange,
    onClose,
  }: { protocol: Protocol; onChange: (protocol: Protocol) => void; onClose: () => void } = $props()
  const { t } = usePreferences()
  const choices: Protocol[] = ['auto', 'v3', 'v4']
</script>

<AppDialog title={t('swapSettings')} description={t('settingsDescription')} {onClose}>
  <Field.Set class="gap-2">
    <Field.Legend variant="label" class="mb-0 text-xs font-normal text-muted-foreground">{t('protocolPreference')}</Field.Legend>
    <RadioGroup.Root class="gap-2" value={protocol} onValueChange={(value) => onChange(value as Protocol)}>
      {#each choices as choice (choice)}
        <Field.Label for={`protocol-${choice}`}>
          <Field.Field orientation="horizontal" class="items-center">
            <Field.Content>
              <Field.Title class="text-sm font-medium">{choice === 'auto' ? t('protocolAuto') : choice.toUpperCase()}</Field.Title>
              <Field.Description class="text-[11px]">
                {choice === 'auto' ? t('autoRouteDescription') : choice === 'v3' ? t('v3FeePlan') : t('v4FeePlan')}
              </Field.Description>
            </Field.Content>
            <RadioGroup.Item value={choice} id={`protocol-${choice}`} />
          </Field.Field>
        </Field.Label>
      {/each}
    </RadioGroup.Root>
  </Field.Set>
  <Item.Root variant="muted" size="sm" class="rounded-xl">
    <Item.Content><Item.Description class="text-xs">{t('platformProtocolFee')}</Item.Description></Item.Content>
    <Item.Actions><strong class="text-xs font-medium">0% / 0%</strong></Item.Actions>
  </Item.Root>
  <DialogNote>{t('settingsNote')}</DialogNote>
</AppDialog>
