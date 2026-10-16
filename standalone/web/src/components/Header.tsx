import type { ReactElement } from 'react'
import { shortenAddress } from '../domain/assets'
import type { WalletController } from '../lib/useWallet'
import { usePreferences } from '../preferences/context'
import { Button, Icon, NetworkIcon, SodaMark } from './primitives'

export type Page = 'swap' | 'assets' | 'pools'

interface HeaderProps {
  page: Page
  onPageChange: (page: Page) => void
  wallet: WalletController
  onWallet: () => void
  onSearch: () => void
  onPreferences: () => void
}

export function Header({ page, onPageChange, wallet, onWallet, onSearch, onPreferences }: HeaderProps): ReactElement {
  const { t } = usePreferences()
  const pages: { id: Page; name: string }[] = [
    { id: 'swap', name: t('navSwap') },
    { id: 'assets', name: t('navAssets') },
    { id: 'pools', name: t('navPools') },
  ]
  return (
    <header className="site-header">
      <button className="brand" onClick={() => onPageChange('swap')} aria-label={t('home')}>
        <SodaMark decorative />
        <span>
          Soda<span className="brand-dex">Dex</span>
        </span>
        <span className="test-tag">TEST</span>
      </button>
      <nav aria-label={t('mainNavigation')} className="main-nav">
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
          <NetworkIcon />
          <span>X Layer</span>
        </span>
        <Button
          appearance="icon"
          className="header-tool"
          aria-label={t('globalSearch')}
          aria-haspopup="dialog"
          onClick={onSearch}
        >
          <Icon name="search" />
        </Button>
        <Button
          appearance="primary"
          className="header-connect"
          onClick={onWallet}
          aria-label={wallet.session ? shortenAddress(wallet.session.address) : t('connectWallet')}
        >
          <Icon name="wallet" size={17} />
          <span>{wallet.session ? shortenAddress(wallet.session.address) : t('headerConnect')}</span>
        </Button>
        <Button
          appearance="icon"
          className="header-tool"
          aria-label={t('preferences')}
          aria-haspopup="dialog"
          onClick={onPreferences}
        >
          <Icon name="more" />
        </Button>
      </div>
    </header>
  )
}
