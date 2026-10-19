import { getContext, setContext } from 'svelte'
import { translator } from '../i18n'
import type { Translate } from '../i18n/types'
import { persistPreferences, readPreferences, type Currency, type Locale, type Preferences, type Theme } from './model'

const translators = new Map<Locale, Translate>()
const translate = (locale: Locale): Translate => {
  let value = translators.get(locale)
  if (!value) {
    value = translator(locale)
    translators.set(locale, value)
  }
  return value
}

export class PreferencesStore {
  locale = $state<Locale>('zh-CN')
  theme = $state<Theme>('light')
  currency = $state<Currency>('CNY')

  constructor(initial: Preferences = readPreferences()) {
    this.locale = initial.locale
    this.theme = initial.theme
    this.currency = initial.currency
  }

  /** Reads `locale` on every call, so a destructured `t` still re-renders when the language changes. */
  readonly t: Translate = ((key, ...args) => translate(this.locale)(key, ...args)) as Translate

  update(change: Partial<Preferences>): void {
    if (change.locale) this.locale = change.locale
    if (change.theme) this.theme = change.theme
    if (change.currency) this.currency = change.currency
  }

  /** Mirrors the preference onto storage and the document; call from an effect. */
  apply(): void {
    persistPreferences({ locale: this.locale, theme: this.theme, currency: this.currency })
    const root = document.documentElement
    root.lang = this.locale
    root.dataset.theme = this.theme
    document.title = this.t('pageTitle')
    document.querySelector('meta[name="description"]')?.setAttribute('content', this.t('pageDescription'))
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', this.theme === 'light' ? '#f2f4e9' : '#101310')
  }
}

const KEY = Symbol('preferences')

export function providePreferences(): PreferencesStore {
  return setContext(KEY, new PreferencesStore())
}

export function usePreferences(): PreferencesStore {
  const value = getContext<PreferencesStore | undefined>(KEY)
  if (!value) throw new Error('providePreferences() is required')
  return value
}
