import type { ReactElement } from 'react'
import { PROTOCOL_NAMES, type Protocol } from '../domain/assets'
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
  return (
    <Dialog title="兑换设置" description="选择后续兑换时优先使用的协议。" onClose={onClose}>
      <fieldset className="protocol-options">
        <legend>协议偏好</legend>
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
              <strong>{PROTOCOL_NAMES[choice]}</strong>
              <span>
                {choice === 'auto'
                  ? '开放后根据可用路由报价'
                  : choice === 'v3'
                    ? '测试池费率计划 0.01%'
                    : '测试池费率计划 0%'}
              </span>
            </span>
            {protocol === choice && <Icon name="check" />}
          </label>
        ))}
      </fieldset>
      <div className="settings-summary">
        <span>平台费 / 协议费</span>
        <strong>0% / 0%</strong>
      </div>
      <p className="dialog-note">当前为测试部署配置。合约与流动性准备完成后才会开放报价和兑换。</p>
    </Dialog>
  )
}
