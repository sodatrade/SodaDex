import { useState, type ReactElement } from 'react'
import { CHAIN_ID, EXPLORER_URL, shortenAddress } from '../domain/assets'
import type { WalletController } from '../lib/useWallet'
import { usePreferences } from '../preferences/context'
import { Dialog } from './Dialog'
import { Button, Icon } from './primitives'

export function WalletDialog({ wallet, onClose }: { wallet: WalletController; onClose: () => void }): ReactElement {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const { t } = usePreferences()
  const session = wallet.session
  const busy = wallet.status !== 'idle'

  const copyAddress = async (): Promise<void> => {
    if (!session) {
      return
    }
    try {
      await navigator.clipboard.writeText(session.address)
      setCopied(true)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }

  return (
    <Dialog
      title={session ? t('walletTitle') : t('connectWallet')}
      description={
        session ? (session.id === 'injected' ? t('browserWallet') : session.name) : t('walletConnectDescription')
      }
      onClose={onClose}
    >
      {session ? (
        <div className="connected-wallet">
          <span className="wallet-avatar">
            <Icon name="wallet" size={26} />
          </span>
          <strong className="wallet-address">{shortenAddress(session.address)}</strong>
          <span className="subtle">
            {session.chainId === CHAIN_ID ? t('walletConnected') : t('walletNetwork', { chainId: session.chainId })}
          </span>
          <div className="wallet-actions">
            <Button onClick={() => void copyAddress()}>
              <Icon name={copied ? 'check' : 'copy'} />
              {copied ? t('copied') : t('copyAddress')}
            </Button>
            <a
              className="button button-secondary"
              href={`${EXPLORER_URL}/address/${session.address}`}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="external" />
              {t('explorer')}
            </a>
          </div>
          <p className="sr-only" role="status">
            {copied ? t('addressCopied') : ''}
          </p>
          {copyError && (
            <p role="alert" className="error-text">
              {t('copyFailed')}
            </p>
          )}
          {session.chainId !== CHAIN_ID && (
            <Button appearance="primary" disabled={busy} onClick={() => void wallet.switchChain()}>
              {wallet.status === 'switching' ? t('waitingWallet') : t('switchNetwork')}
            </Button>
          )}
          <Button
            appearance="ghost"
            disabled={busy}
            onClick={() => {
              wallet.disconnect()
              onClose()
            }}
          >
            {t('disconnect')}
          </Button>
        </div>
      ) : (
        <div className="wallet-options">
          {wallet.options.map((option) => (
            <button
              className="wallet-option"
              key={option.id}
              disabled={busy}
              onClick={() => void wallet.connect(option)}
            >
              <span className="wallet-option-icon">
                <Icon name="wallet" />
              </span>
              <strong>{option.id === 'injected' ? t('browserWallet') : option.name}</strong>
              <span className="subtle">
                {busy ? t('waitingConfirmation') : t('connect')}
                <Icon name="chevron" size={16} />
              </span>
            </button>
          ))}
          {wallet.options.length === 0 && (
            <div className="wallet-empty">
              <Icon name="wallet" size={32} />
              <h3>{t('walletEmptyTitle')}</h3>
              <p>{t('walletEmptyDescription')}</p>
            </div>
          )}
        </div>
      )}
      {wallet.error && (
        <p className="error-text" role="alert">
          {t(wallet.error)}
        </p>
      )}
      <p className="dialog-note">{t('walletReadOnly')}</p>
    </Dialog>
  )
}
