import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactElement } from 'react'
import { AssetPage, type AssetSelection } from './components/AssetPage'
import { GlobalSearchDialog } from './components/GlobalSearchDialog'
import { Header, type Page } from './components/Header'
import { PoolsPage } from './components/PoolsPage'
import { PreferencesDialog } from './components/PreferencesDialog'
import { Button, Icon, SodaMark } from './components/primitives'
import { SwapCard } from './components/SwapCard'
import { WalletDialog } from './components/WalletDialog'
import { CHAIN_ID } from './domain/assets'
import { HistoryPage } from './features/history/HistoryPage'
import { MarketPage } from './features/market/MarketPage'
import { getBalances, getNetworkStatus } from './lib/rpc'
import { useWallet } from './lib/useWallet'
import { usePreferences } from './preferences/context'
import { PreferencesProvider } from './preferences/PreferencesProvider'
import { POOLS, publicSwapsEnabled } from './trading/config'

export function App(): ReactElement {
  return (
    <PreferencesProvider>
      <AppContent />
    </PreferencesProvider>
  )
}

function AppContent(): ReactElement {
  const fromHash = (): Page => {
    const hash = window.location.hash.slice(1)
    return ['swap', 'assets', 'pools', 'market', 'history'].includes(hash) ? hash as Page : 'swap'
  }
  const [page, setPage] = useState<Page>(fromHash)
  const [walletOpen, setWalletOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<AssetSelection>()
  const { t } = usePreferences()
  const wallet = useWallet()
  const network = useQuery({
    queryKey: ['network', CHAIN_ID],
    queryFn: getNetworkStatus,
    refetchInterval: 20_000,
    retry: 1,
  })
  const address = wallet.session?.address
  const balances = useQuery({
    queryKey: ['balances', CHAIN_ID, address],
    queryFn: () => getBalances(address ?? ''),
    enabled: !!address && wallet.session?.chainId === CHAIN_ID && network.isSuccess,
    refetchInterval: 20_000,
    retry: 1,
  })
  const correctChain = wallet.session?.chainId === CHAIN_ID
  const currentBalances = correctChain ? balances.data : undefined
  const navigate = (next: Page): void => {
    setPage(next)
    window.history.replaceState(null, '', `#${next}`)
  }
  useEffect(() => {
    const changed = (): void => setPage(fromHash())
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {t('skipMain')}
      </a>
      <div className="ambient" aria-hidden="true">
        <div className="ambient-halo" />
        <div className="ambient-grid" />
      </div>
      <Header
        page={page}
        onPageChange={navigate}
        wallet={wallet}
        onWallet={() => setWalletOpen(true)}
        onSearch={() => setSearchOpen(true)}
        onPreferences={() => setPreferencesOpen(true)}
      />
      <div className="test-notice">
        <span className="test-notice-label">{t('testExperience')}</span>
        <p>{t(!publicSwapsEnabled() ? 'testPausedNotice' : POOLS.ready ? 'testTradingNotice' : 'testNotice')}</p>
      </div>
      <main id="main" tabIndex={-1}>
        <div className="trade-layout" hidden={page !== 'swap'}>
          <section className="hero-copy" aria-labelledby="hero-heading">
            <div className="eyebrow">
              <span />
              {t('builtFor')}
            </div>
            <h1 id="hero-heading">
              {t('heroFirst')}
              <br />
              <span className="hero-line-two">{t('heroSecond')}</span>
            </h1>
            <p className="hero-description">
              {t('heroDescriptionFirst')}
              <br />
              {t('heroDescriptionSecond')}
            </p>
            <div className="hero-details">
              <span>{t('nativeOKB')}</span>
              <span>V3 + V4</span>
              <span>{t('lowFeeTest')}</span>
            </div>
            <div className="soda-art" aria-hidden="true">
              <div className="art-orbit orbit-one" />
              <div className="art-orbit orbit-two" />
              <div className="art-bubble bubble-one" />
              <div className="art-bubble bubble-two" />
              <div className="art-bubble bubble-three" />
              <span className="art-word">soda.</span>
            </div>
          </section>
          <div className="trade-workspace">
            <div className="workspace-eyebrow">
              <span className="live-dot" />
              {t('flowStarts')}
              <span>{t('swapIndex')}</span>
            </div>
            <SwapCard
              wallet={wallet}
              balances={currentBalances}
              balancesLoading={balances.isFetching && !balances.data}
              balancesError={balances.isError || network.isError}
              onConnect={() => setWalletOpen(true)}
            />
            <div className="trade-meta">
              <span>
                <Icon name="layers" size={15} />
                {t(POOLS.ready ? 'poolsReady' : 'deploymentPending')}
              </span>
              <span>{t('platformZero')}</span>
            </div>
          </div>
        </div>
        {page === 'assets' ? (
          <AssetPage
            balances={currentBalances}
            connected={!!wallet.session && correctChain}
            loading={balances.isFetching && !balances.data}
            error={!!wallet.session && (balances.isError || network.isError)}
            selected={selectedAsset}
          />
        ) : page === 'pools' ? (
          <PoolsPage onSwap={() => navigate('swap')} />
        ) : page === 'market' ? (
          <MarketPage />
        ) : page === 'history' ? (
          <HistoryPage wallet={wallet} onConnect={() => setWalletOpen(true)} />
        ) : null}
      </main>
      <footer className="site-footer">
        <div className={`rpc-status${network.isError ? ' status-error' : ''}`} role="status">
          <span className="status-dot" />
          <span>
            {network.isPending
              ? t('networkLoading')
              : network.isError
                ? t('networkUnavailable')
                : t('networkConnected')}
          </span>
          {network.data && <span className="block-number">#{network.data.block.toString()}</span>}
          {network.isError && (
            <Button appearance="ghost" onClick={() => void network.refetch()} disabled={network.isFetching}>
              <Icon name="refresh" size={14} />
              {t('retry')}
            </Button>
          )}
        </div>
        <div className="footer-brand">
          <SodaMark decorative />
          <span>
            SodaDEX <span>·</span> {t('footerFlow')}
          </span>
        </div>
        <a href="https://github.com/sodatrade/SodaDex" target="_blank" rel="noreferrer">
          GitHub
          <Icon name="external" size={13} />
        </a>
      </footer>
      {walletOpen && <WalletDialog wallet={wallet} onClose={() => setWalletOpen(false)} />}
      {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}
      {searchOpen && (
        <GlobalSearchDialog
          onClose={() => setSearchOpen(false)}
          onPool={() => {
            navigate('pools')
            setSearchOpen(false)
          }}
          onAsset={(asset) => {
            setSelectedAsset({ id: asset })
            navigate('assets')
            setSearchOpen(false)
          }}
        />
      )}
    </div>
  )
}
