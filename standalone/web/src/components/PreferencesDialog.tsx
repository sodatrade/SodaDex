import { useId, type ReactElement } from 'react'
import { usePreferences } from '../preferences/context'
import { CURRENCIES, LOCALES, THEMES, LANGUAGE_NAMES } from '../preferences/model'
import { Dialog } from './Dialog'
import { Icon } from './primitives'


export function PreferencesDialog({ onClose, currencyOnly = false }: { onClose: () => void; currencyOnly?: boolean }): ReactElement {
  const { t, theme, locale, currency, update } = usePreferences()
  const id = useId()
  return (
    <Dialog title={t('preferences')} description={t('preferencesDescription')} onClose={onClose}>
      {!currencyOnly && <><fieldset className="preference-group">
        <legend>{t('appearance')}</legend>
        <div className="theme-options">
          {THEMES.map((choice) => (
            <label className={`theme-option${theme === choice ? ' selected' : ''}`} key={choice}>
              <input
                type="radio"
                name={`${id}-theme`}
                value={choice}
                checked={theme === choice}
                onChange={() => update({ theme: choice })}
              />
              <Icon name={choice === 'light' ? 'sun' : 'moon'} />
              <span>{t(choice === 'light' ? 'themeLight' : 'themeDark')}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="preference-select">
        <label htmlFor={`${id}-language`}>{t('language')}</label>
        <select
          id={`${id}-language`}
          value={locale}
          onChange={(event) => {
            const selected = LOCALES.find((choice) => choice === event.target.value)
            if (selected) {
              update({ locale: selected })
            }
          }}
        >
          {LOCALES.map((choice) => (
            <option key={choice} value={choice} lang={choice}>
              {LANGUAGE_NAMES[choice]}
            </option>
          ))}
        </select>
      </div>
      </>}
      <div className="preference-select">
        <label htmlFor={`${id}-currency`}>{t('displayCurrency')}</label>
        <select
          id={`${id}-currency`}
          value={currency}
          onChange={(event) => {
            const selected = CURRENCIES.find((choice) => choice === event.target.value)
            if (selected) {
              update({ currency: selected })
            }
          }}
        >
          {CURRENCIES.map((choice) => (
            <option key={choice} value={choice}>
              {choice} · {t(choice === 'CNY' ? 'currencyCNY' : choice === 'USD' ? 'currencyUSD' : 'currencyHKD')}
            </option>
          ))}
        </select>
      </div>
      <p className="dialog-note">{t('currencyNote')}</p>
    </Dialog>
  )
}
