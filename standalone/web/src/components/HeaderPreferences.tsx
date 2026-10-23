import type { ReactElement } from 'react'
import { usePreferences } from '../preferences/context'
import { LOCALES, THEMES, LANGUAGE_NAMES } from '../preferences/model'
import { Button, Icon } from './primitives'

export function HeaderPreferences({ onCurrency }: { onCurrency: () => void }): ReactElement {
  const { t, theme, locale, currency, update } = usePreferences()
  return <div className="header-preferences">
    <div className="header-theme" role="group" aria-label={t('appearance')}>
      {THEMES.map(choice => <Button key={choice} appearance="icon"
        aria-label={t(choice === 'light' ? 'themeLight' : 'themeDark')}
        title={t(choice === 'light' ? 'themeLight' : 'themeDark')}
        aria-pressed={theme === choice} onClick={() => update({ theme: choice })}>
        <Icon name={choice === 'light' ? 'sun' : 'moon'} />
      </Button>)}
    </div>
    <select aria-label={t('language')} value={locale} onChange={event => {
      const selected = LOCALES.find(choice => choice === event.target.value)
      if (selected) update({ locale: selected })
    }}>
      {LOCALES.map(choice => <option key={choice} value={choice} lang={choice}>{LANGUAGE_NAMES[choice]}</option>)}
    </select>
    <Button appearance="ghost" aria-label={t('displayCurrency')} title={t('displayCurrency')} onClick={onCurrency}>{currency}</Button>
  </div>
}
