import { useState, type ReactElement } from 'react'
import { amountError, formatBalance } from '../domain/amount'
import { CHAIN_ID, PROTOCOL_NAMES, getAsset, type AssetId, type Protocol } from '../domain/assets'
import type { WalletController } from '../lib/useWallet'
import { AssetDialog } from './AssetDialog'
import { AssetIcon, Button, Icon, Surface } from './primitives'
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
      return '余额 —'
    }
    if (balancesLoading) {
      return '读取余额…'
    }
    if (balancesError) {
      return '余额暂不可用'
    }
    return balances ? `余额 ${formatBalance(balances[id])}` : '余额 —'
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
      <Surface className="swap-card" aria-label="资产兑换">
        <div className="swap-card-heading">
          <div>
            <h2>兑换</h2>
            <span className="card-caption">简单一点，流动起来。</span>
          </div>
          <Button appearance="icon" aria-label="兑换设置" onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" />
          </Button>
        </div>
        <div className={`amount-panel${error ? ' has-error' : ''}`}>
          <div className="amount-label">
            <label htmlFor="sell-amount">支付</label>
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
              aria-label={`选择支付资产，当前 ${from.symbol}`}
            >
              <AssetIcon wrapped={fromId === 'wokb'} small />
              <strong>{from.symbol}</strong>
              <Icon name="chevron" size={16} />
            </button>
          </div>
          <span className="amount-hint">{from.description}</span>
        </div>
        <div className="direction-row">
          <Button
            appearance="icon"
            className="direction-button"
            aria-label="切换支付与接收资产"
            onClick={changeDirection}
          >
            <Icon name="arrow" size={19} />
          </Button>
        </div>
        <div className="amount-panel receive-panel">
          <div className="amount-label">
            <span>接收</span>
            <span>{balanceText(toId)}</span>
          </div>
          <div className="amount-row">
            <output className="receive-amount" aria-label="预计接收数量">
              —
            </output>
            <button
              className="token-selector"
              onClick={() => setSelector('to')}
              aria-label={`选择接收资产，当前 ${to.symbol}`}
            >
              <AssetIcon wrapped={toId === 'wokb'} small />
              <strong>{to.symbol}</strong>
              <Icon name="chevron" size={16} />
            </button>
          </div>
          <span className="amount-hint">等待测试兑换开放后报价</span>
        </div>
        {error && (
          <p id="amount-error" className="amount-error" role="alert">
            {error}
          </p>
        )}
        <div className="route-summary">
          <span>
            <span className="small-spark" />X Layer
          </span>
          <button onClick={() => setSettingsOpen(true)}>
            路由 · {PROTOCOL_NAMES[protocol]}
            <Icon name="chevron" size={14} />
          </button>
        </div>
        <Button
          appearance="primary"
          className="swap-action"
          disabled={busy || (!!wallet.session && !wrongChain)}
          onClick={primaryAction}
        >
          {busy ? '等待钱包确认…' : !wallet.session ? '连接钱包' : wrongChain ? '切换到 X Layer' : '测试合约准备中'}
          {!wallet.session && <Icon name="wallet" size={19} />}
        </Button>
        <p className="swap-footnote">
          <span className="status-dot" />
          当前仅开放连接与余额查询，暂不发起兑换。
        </p>
        {wallet.error && (
          <p className="error-text" role="alert">
            {wallet.error}
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
