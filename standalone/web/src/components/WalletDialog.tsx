import { useState, type ReactElement } from 'react'
import { CHAIN_ID, EXPLORER_URL, shortenAddress } from '../domain/assets'
import type { WalletController } from '../lib/useWallet'
import { Dialog } from './Dialog'
import { Button, Icon } from './primitives'

export function WalletDialog({ wallet, onClose }: { wallet: WalletController; onClose: () => void }): ReactElement {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
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
      title={session ? '我的钱包' : '连接钱包'}
      description={session ? session.name : '使用你已安装的浏览器钱包连接 SodaDex。'}
      onClose={onClose}
    >
      {session ? (
        <div className="connected-wallet">
          <span className="wallet-avatar">
            <Icon name="wallet" size={26} />
          </span>
          <strong className="wallet-address">{shortenAddress(session.address)}</strong>
          <span className="subtle">
            {session.chainId === CHAIN_ID ? 'X Layer · 已连接' : `当前网络 ID ${session.chainId}`}
          </span>
          <div className="wallet-actions">
            <Button onClick={() => void copyAddress()}>
              <Icon name={copied ? 'check' : 'copy'} />
              {copied ? '已复制' : '复制地址'}
            </Button>
            <a
              className="button button-secondary"
              href={`${EXPLORER_URL}/address/${session.address}`}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="external" />
              区块浏览器
            </a>
          </div>
          <p className="sr-only" role="status">
            {copied ? '钱包地址已复制' : ''}
          </p>
          {copyError && (
            <p role="alert" className="error-text">
              复制未完成，可在钱包中查看完整地址。
            </p>
          )}
          {session.chainId !== CHAIN_ID && (
            <Button appearance="primary" disabled={busy} onClick={() => void wallet.switchChain()}>
              {wallet.status === 'switching' ? '等待钱包确认…' : '切换到 X Layer'}
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
            断开连接
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
              <strong>{option.name}</strong>
              <span className="subtle">
                {busy ? '等待确认…' : '连接'}
                <Icon name="chevron" size={16} />
              </span>
            </button>
          ))}
          {wallet.options.length === 0 && (
            <div className="wallet-empty">
              <Icon name="wallet" size={32} />
              <h3>尚未检测到浏览器钱包</h3>
              <p>请先安装或启用支持以太坊的浏览器钱包，再刷新页面。手机上可在钱包的 DApp 浏览器中打开本站。</p>
            </div>
          )}
        </div>
      )}
      {wallet.error && (
        <p className="error-text" role="alert">
          {wallet.error}
        </p>
      )}
      <p className="dialog-note">连接只用于读取公开地址和余额，不会发起交易。</p>
    </Dialog>
  )
}
