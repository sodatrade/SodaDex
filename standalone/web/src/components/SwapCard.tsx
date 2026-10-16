import { useState, type ReactElement } from 'react'
import { amountError, formatBalance } from '../domain/amount'
import { CHAIN_ID, getAsset, type AssetId, type Protocol } from '../domain/assets'
import type { WalletController } from '../lib/useWallet'
import { usePreferences } from '../preferences/context'
import { AssetDialog } from './AssetDialog'
import { AssetIcon, Button, Icon, NetworkIcon, Surface } from './primitives'
import { SettingsDialog } from './SettingsDialog'

interface SwapCardProps {
  wallet: WalletController
  balances: Record<AssetId, bigint> | undefined
  balancesLoading: boolean
  balancesError: boolean
  onConnect: () => void
}

export function SwapCard({ wallet, balances, balancesLoading, balancesError, onConnect }: SwapCardProps): ReactElement {
  const [fromId, setFromId] = useState<AssetId>('okb')
  const [toId, setToId] = useState<AssetId>('wokb')
  const [amount, setAmount] = useState('')
  const [selector, setSelector] = useState<'from' | 'to'>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [protocol, setProtocol] = useState<Protocol>('auto')
  const { t } = usePreferences()
  const from = getAsset(fromId)
  const to = getAsset(toId)
  const error = amountError(amount, balances?.[fromId])
  const wrongChain = wallet.session && wallet.session.chainId !== CHAIN_ID
  const busy = wallet.status !== 'idle'

  const changeDirection = (): void => {
    setFromId(toId)
    setToId(fromId)
    setAmount('')
  }

  const selectAsset = (id: AssetId): void => {
    if (selector === 'from') {
      if (id === toId) {
        setToId(fromId)
      }
      setFromId(id)
    } else {
      if (id === fromId) {
        setFromId(toId)
      }
      setToId(id)
    }
    setAmount('')
    setSelector(undefined)
  }

  const balanceText = (id: AssetId): string => {
    if (!wallet.session || wrongChain) {
      return t('balanceEmpty')
    }
    if (balancesLoading) {
      return t('balanceLoading')
    }
    if (balancesError) {
      return t('balanceUnavailable')
    }
    return balances ? t('balanceValue', { amount: formatBalance(balances[id]) }) : t('balanceEmpty')
  }

  const primaryAction = (): void => {
    if (!wallet.session) {
      onConnect()
    } else if (wrongChain) {
      void wallet.switchChain()
    }
  }

  return (
    <>
      <Surface className="swap-card" aria-label={t('swapRegion')}>
        <div className="swap-card-heading">
          <div>
            <h2>{t('navSwap')}</h2>
            <span className="card-caption">{t('swapCaption')}</span>
          </div>
          <Button appearance="icon" aria-label={t('swapSettings')} onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" />
          </Button>
        </div>
        <div className={`amount-panel${error ? ' has-error' : ''}`}>
          <div className="amount-label">
            <label htmlFor="sell-amount">{t('pay')}</label>
            <span>{balanceText(fromId)}</span>
          </div>
          <div className="amount-row">
            <input
              id="sell-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value.slice(0, 100))}
              aria-invalid={!!error}
              aria-describedby={error ? 'amount-error' : undefined}
            />
            <button
              className="token-selector"
              onClick={() => setSelector('from')}
              aria-label={t('choosePay', { symbol: from.symbol })}
            >
              <AssetIcon wrapped={fromId === 'wokb'} small />
              <strong>{from.symbol}</strong>
              <Icon name="chevron" size={16} />
            </button>
          </div>
          <span className="amount-hint">{t(fromId === 'okb' ? 'nativeAsset' : 'wrappedAsset')}</span>
        </div>
        <div className="direction-row">
          <Button
            appearance="icon"
            className="direction-button"
            aria-label={t('changeDirection')}
            onClick={changeDirection}
          >
            <Icon name="arrow" size={19} />
          </Button>
        </div>
        <div className="amount-panel receive-panel">
          <div className="amount-label">
            <span>{t('receive')}</span>
            <span>{balanceText(toId)}</span>
          </div>
          <div className="amount-row">
            <output className="receive-amount" aria-label={t('receiveAmount')}>
              —
            </output>
            <button
              className="token-selector"
              onClick={() => setSelector('to')}
              aria-label={t('chooseReceive', { symbol: to.symbol })}
            >
              <AssetIcon wrapped={toId === 'wokb'} small />
              <strong>{to.symbol}</strong>
              <Icon name="chevron" size={16} />
            </button>
          </div>
          <span className="amount-hint">{t('quotePending')}</span>
        </div>
        {error && (
          <p id="amount-error" className="amount-error" role="alert">
            {error.code === 'amountPrecision' ? t(error.code, { decimals: error.decimals }) : t(error.code)}
          </p>
        )}
        <div className="route-summary">
          <span>
            <NetworkIcon small />X Layer
          </span>
          <button onClick={() => setSettingsOpen(true)}>
            {t('route', { protocol: protocol === 'auto' ? t('protocolAuto') : protocol.toUpperCase() })}
            <Icon name="chevron" size={14} />
          </button>
        </div>
        <Button
          appearance="primary"
          className="swap-action"
          disabled={busy || (!!wallet.session && !wrongChain)}
          onClick={primaryAction}
        >
          {busy
            ? t('waitingWallet')
            : !wallet.session
              ? t('connectWallet')
              : wrongChain
                ? t('switchNetwork')
                : t('contractsPending')}
          {!wallet.session && <Icon name="wallet" size={19} />}
        </Button>
        <p className="swap-footnote">
          <span className="status-dot" />
          {t('swapReadOnly')}
        </p>
        {wallet.error && (
          <p className="error-text" role="alert">
            {t(wallet.error)}
          </p>
        )}
      </Surface>
      {selector && (
        <AssetDialog
          selected={selector === 'from' ? fromId : toId}
          onSelect={selectAsset}
          onClose={() => setSelector(undefined)}
        />
      )}
      {settingsOpen && (
        <SettingsDialog protocol={protocol} onChange={setProtocol} onClose={() => setSettingsOpen(false)} />
      )}
    </>
  )
}
