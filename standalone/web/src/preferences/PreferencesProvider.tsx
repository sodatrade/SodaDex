import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { translator } from '../i18n'
import { PreferencesContext, type PreferencesContextValue } from './context'
import { persistPreferences, readPreferences, type Preferences } from './model'

export function PreferencesProvider({ children }: { children: ReactNode }): ReactElement {
  const [preferences, setPreferences] = useState<Preferences>(readPreferences)
  const t = useMemo(() => translator(preferences.locale), [preferences.locale])

  useEffect(() => {
    persistPreferences(preferences)
    document.documentElement.lang = preferences.locale
    document.documentElement.dataset.theme = preferences.theme
    document.title = t('pageTitle')
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('pageDescription'))
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', preferences.theme === 'light' ? '#f2f4e9' : '#101310')
  }, [preferences, t])

  const value = useMemo(
    (): PreferencesContextValue => ({
      ...preferences,
      t,
      update: (change) => setPreferences((current) => ({ ...current, ...change })),
    }),
    [preferences, t],
  )
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}
