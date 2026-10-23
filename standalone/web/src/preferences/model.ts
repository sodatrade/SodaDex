export const LOCALES = ['zh-CN', 'en', 'yue-HK'] as const
export const THEMES = ['light', 'dark'] as const
export const CURRENCIES = ['CNY', 'USD', 'HKD'] as const
export type Locale = (typeof LOCALES)[number]
export type Theme = (typeof THEMES)[number]
export type Currency = (typeof CURRENCIES)[number]
export interface Preferences {
  locale: Locale
  theme: Theme
  currency: Currency
}
export const DEFAULT_PREFERENCES: Preferences = { locale: 'zh-CN', theme: 'light', currency: 'CNY' }
export const PREFERENCES_KEY = 'sodadex.preferences.v1'
export const CURRENCY_SYMBOLS: Record<Currency, string> = { CNY: '¥', USD: '$', HKD: 'HK$' }

export function readPreferences(): Preferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ...DEFAULT_PREFERENCES }
    }
    const stored = value as Record<string, unknown>
    return {
      locale: LOCALES.find((locale) => locale === stored.locale) ?? DEFAULT_PREFERENCES.locale,
      theme: THEMES.find((theme) => theme === stored.theme) ?? DEFAULT_PREFERENCES.theme,
      currency: CURRENCIES.find((currency) => currency === stored.currency) ?? DEFAULT_PREFERENCES.currency,
    }
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export function persistPreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
  } catch {
    /* Preferences still work in memory when browser storage is unavailable. */
  }
}
