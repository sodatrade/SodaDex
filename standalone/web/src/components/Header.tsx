import { NETWORK } from '../network'
import type { MiningTab } from '../mining/navigation'
import type { ReactElement } from 'react'
import { shortenAddress } from '../lib/address'
import { workspaceMessages } from '../i18n/workspace'
import { primaryPage, type Page } from '../features/workspace/navigation'
import type { WalletController } from '../lib/useWallet'
import { usePreferences } from '../preferences/context'
import { Button, Icon, NetworkIcon, SodaMark } from './primitives'
import { IgnixLaunchLink } from './IgnixLaunchLink'

export type { Page } from '../features/workspace/navigation'

interface HeaderProps {
  page: Page
  onPageChange: (page: Page) => void
  wallet: WalletController
  onWallet: () => void
  onSearch?: () => void
  miningPage?: MiningTab
  onMiningPageChange?: (page: MiningTab) => void
  navigationDisabled?: boolean
  onPreferences: () => void
}

export function Header({ page, onPageChange, wallet, onWallet, onSearch, onPreferences, miningPage, navigationDisabled = false }: HeaderProps): ReactElement {
  const { t, locale, currency } = usePreferences()
  const m = workspaceMessages(locale)
  const group = miningPage ? undefined : primaryPage(page)
  const pages: { id: Page; name: string }[] = [
    { id: 'swap', name: m.trade },
    { id: 'explore', name: m.explore },
    { id: 'pools', name: t('navPools') },
    { id: 'portfolio', name: m.portfolio },
  ]
  return (
    <header className="site-header">
      <button disabled={navigationDisabled} className="brand" onClick={() => onPageChange('swap')} aria-label={t('home')}>
        <SodaMark decorative />
        <span>
          Soda<span className="brand-dex">DEX</span>
        </span>
      </button>
      <nav aria-label={t('mainNavigation')} className="main-nav">
        {pages.map((item) => (
          <button
            key={item.id}
            disabled={navigationDisabled}
            className={group === item.id ? 'active' : ''}
            aria-current={group === item.id ? 'page' : undefined}
            onClick={() => onPageChange(item.id)}
          >
            {item.name}
          </button>
        ))}
        {!navigationDisabled && <IgnixLaunchLink />}
      </nav>
      <div className="header-actions">
        {onSearch && <Button
          appearance="ghost"
          className="header-search"
          aria-label={t('globalSearch')}
          aria-haspopup="dialog"
          onClick={onSearch}
        >
          <Icon name="search" />
          <span>{t('globalSearchPlaceholder')}</span>
        </Button>}
        <span className="network-badge">
          <NetworkIcon />
          <span>{NETWORK.chainId === 1952 ? 'X Layer · 1952' : 'X Layer · 196'}</span>
        </span>
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
          className="header-tool header-preferences"
          aria-label={t('preferences')}
          aria-haspopup="dialog"
          onClick={onPreferences}
        >
          <Icon name="settings" size={18} />
          <span>{currency}</span>
        </Button>
      </div>
    </header>
  )
}
