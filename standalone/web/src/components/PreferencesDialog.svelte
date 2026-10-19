<script lang="ts">
  import Moon from '@lucide/svelte/icons/moon'
  import Sun from '@lucide/svelte/icons/sun'
  import * as Field from '$lib/components/ui/field'
  import * as RadioGroup from '$lib/components/ui/radio-group'
  import * as Select from '$lib/components/ui/select'
  import { CURRENCIES, LOCALES, THEMES, type Currency, type Locale, type Theme } from '../preferences/model'
  import { usePreferences } from '../preferences/preferences.svelte'
  import AppDialog from './AppDialog.svelte'
  import DialogNote from './DialogNote.svelte'

  let { onClose }: { onClose: () => void } = $props()
  const preferences = usePreferences()
  const { t } = preferences
  const LANGUAGE_NAMES: Record<Locale, string> = { 'zh-CN': '简体中文', en: 'English', 'yue-HK': '粵語' }
  const currencyName = (choice: Currency): string =>
    `${choice} · ${t(choice === 'CNY' ? 'currencyCNY' : choice === 'USD' ? 'currencyUSD' : 'currencyHKD')}`
</script>

<AppDialog title={t('preferences')} description={t('preferencesDescription')} {onClose}>
  <Field.Group class="gap-5">
    <Field.Set class="gap-2">
      <Field.Legend variant="label" class="mb-0 text-xs font-normal text-muted-foreground">{t('appearance')}</Field.Legend>
      <RadioGroup.Root
        class="grid grid-cols-2 gap-2"
        value={preferences.theme}
        onValueChange={(value) => preferences.update({ theme: value as Theme })}
      >
        {#each THEMES as choice (choice)}
          <Field.Label for={`theme-${choice}`}>
            <Field.Field orientation="horizontal" class="items-center">
              <RadioGroup.Item value={choice} id={`theme-${choice}`} class="sr-only" />
              <span class="flex w-full items-center justify-center gap-2 text-[13px]">
                {#if choice === 'light'}<Sun class="size-4.5" />{:else}<Moon class="size-4.5" />{/if}
                {t(choice === 'light' ? 'themeLight' : 'themeDark')}
              </span>
            </Field.Field>
          </Field.Label>
        {/each}
      </RadioGroup.Root>
    </Field.Set>

    <Field.Field class="gap-2">
      <Field.Label for="preference-language" class="text-xs font-normal text-muted-foreground">{t('language')}</Field.Label>
      <Select.Root
        type="single"
        value={preferences.locale}
        onValueChange={(value) => {
          const selected = LOCALES.find((choice) => choice === value)
          if (selected) preferences.update({ locale: selected })
        }}
      >
        <Select.Trigger id="preference-language" class="w-full">{LANGUAGE_NAMES[preferences.locale]}</Select.Trigger>
        <Select.Content>
          {#each LOCALES as choice (choice)}
            <Select.Item value={choice} label={LANGUAGE_NAMES[choice]} lang={choice} />
          {/each}
        </Select.Content>
      </Select.Root>
    </Field.Field>

    <Field.Field class="gap-2">
      <Field.Label for="preference-currency" class="text-xs font-normal text-muted-foreground">{t('displayCurrency')}</Field.Label>
      <Select.Root
        type="single"
        value={preferences.currency}
        onValueChange={(value) => {
          const selected = CURRENCIES.find((choice) => choice === value)
          if (selected) preferences.update({ currency: selected })
        }}
      >
        <Select.Trigger id="preference-currency" class="w-full">{currencyName(preferences.currency)}</Select.Trigger>
        <Select.Content>
          {#each CURRENCIES as choice (choice)}
            <Select.Item value={choice} label={currencyName(choice)} />
          {/each}
        </Select.Content>
      </Select.Root>
    </Field.Field>
  </Field.Group>
  <DialogNote>{t('currencyNote')}</DialogNote>
</AppDialog>
