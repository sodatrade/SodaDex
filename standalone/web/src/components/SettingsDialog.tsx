import type { ReactElement } from 'react'
import { type Protocol } from '../domain/assets'
import { usePreferences } from '../preferences/context'
import { Dialog } from './Dialog'
import { Icon } from './primitives'

export function SettingsDialog({
  protocol,
  onChange,
  onClose,
}: {
  protocol: Protocol
  onChange: (protocol: Protocol) => void
  onClose: () => void
}): ReactElement {
  const choices: Protocol[] = ['auto', 'v3', 'v4']
  const { t } = usePreferences()
  return (
    <Dialog title={t('swapSettings')} description={t('settingsDescription')} onClose={onClose}>
      <fieldset className="protocol-options">
        <legend>{t('protocolPreference')}</legend>
        {choices.map((choice) => (
          <label key={choice} className={`protocol-option${protocol === choice ? ' selected' : ''}`}>
            <input
              type="radio"
              name="protocol"
              value={choice}
              checked={protocol === choice}
              onChange={() => onChange(choice)}
            />
            <span>
              <strong>{choice === 'auto' ? t('protocolAuto') : choice.toUpperCase()}</strong>
              <span>
                {choice === 'auto' ? t('autoRouteDescription') : choice === 'v3' ? t('v3FeePlan') : t('v4FeePlan')}
              </span>
            </span>
            {protocol === choice && <Icon name="check" />}
          </label>
        ))}
      </fieldset>
      <div className="settings-summary">
        <span>{t('platformProtocolFee')}</span>
        <strong>0% / 0%</strong>
      </div>
      <p className="dialog-note">{t('settingsNote')}</p>
    </Dialog>
  )
}
