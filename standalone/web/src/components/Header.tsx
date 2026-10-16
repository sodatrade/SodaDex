import type { ReactElement } from 'react'
import { shortenAddress } from '../domain/assets'
import type { WalletController } from '../lib/useWallet'
import { Button, Icon, SodaMark } from './primitives'

export type Page = 'swap' | 'assets' | 'pools'

interface HeaderProps {
  page: Page
  onPageChange: (page: Page) => void
  wallet: WalletController
  onWallet: () => void
  theme: 'dark' | 'light'
  onTheme: () => void
}

export function Header({ page, onPageChange, wallet, onWallet, theme, onTheme }: HeaderProps): ReactElement {
  const pages: { id: Page; name: string }[] = [
    { id: 'swap', name: '兑换' },
    { id: 'assets', name: '资产' },
    { id: 'pools', name: '流动性' },
  ]
  return (
    <header className="site-header">
      <button className="brand" onClick={() => onPageChange('swap')} aria-label="SodaDex 首页">
        <SodaMark decorative />
        <span>
          Soda<span className="brand-dex">Dex</span>
        </span>
        <span className="test-tag">TEST</span>
      </button>
      <nav aria-label="主导航" className="main-nav">
        {pages.map((item) => (
          <button
            key={item.id}
            className={page === item.id ? 'active' : ''}
            aria-current={page === item.id ? 'page' : undefined}
            onClick={() => onPageChange(item.id)}
          >
            {item.name}
          </button>
        ))}
      </nav>
      <div className="header-actions">
        <span className="network-badge">
          <span className="xlayer-mark" aria-hidden="true">
            ×
          </span>
          <span>X Layer</span>
        </span>
        <Button
          appearance="icon"
          className="theme-button"
          aria-label={theme === 'dark' ? '切换浅色外观' : '切换深色外观'}
          onClick={onTheme}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </Button>
        <Button appearance="primary" className="header-connect" onClick={onWallet}>
          <Icon name="wallet" size={17} />
          <span>{wallet.session ? shortenAddress(wallet.session.address) : '连接钱包'}</span>
        </Button>
      </div>
    </header>
  )
}
