import { createContext, useContext } from 'react'
import type { Translate } from '../i18n/types'
import type { Preferences } from './model'

export interface PreferencesContextValue extends Preferences {
  update: (change: Partial<Preferences>) => void
  t: Translate
}
export const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined)

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext)
  if (!value) {
    throw new Error('PreferencesProvider is required')
  }
  return value
}
