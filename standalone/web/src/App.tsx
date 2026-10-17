import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react'
import type { AssetSelection } from './components/AssetPage'
import type { Address } from 'viem'
import { orderMessages } from './i18n/orders'
import type { TradeMarketContext } from './features/trade/context'
import { WorkspaceTabs } from './features/workspace/WorkspaceTabs'
import { workspaceMessages } from './i18n/workspace'
import { EXPLORE_ROUTES, PORTFOLIO_ROUTES, exploreTab, isPage, portfolioTab, primaryPage } from './features/workspace/navigation'
import './workspace.css'
import { GlobalSearchDialog } from './components/GlobalSearchDialog'
import { Header, type Page } from './components/Header'
import { PreferencesDialog } from './components/PreferencesDialog'
import { Button, Icon, SodaMark } from './components/primitives'
import { WalletDialog } from './components/WalletDialog'
import { CHAIN_ID } from './domain/assets'
import { getBalances, getNetworkStatus } from './lib/rpc'
import { useWallet } from './lib/useWallet'
import { usePreferences } from './preferences/context'
import { PreferencesProvider } from './preferences/PreferencesProvider'
import { POOLS, publicSwapsEnabled } from './trading/config'
const TradeWorkspace = lazy(async () => ({ default: (await import('./features/trade/TradeWorkspace')).TradeWorkspace }))
const LimitOrderPanel = lazy(async () => ({ default: (await import('./features/orders/LimitOrderPanel')).LimitOrderPanel }))
const PortfolioPage = lazy(async () => ({ default: (await import('./features/portfolio/PortfolioPage')).PortfolioPage }))
const ExplorePage = lazy(async () => ({ default: (await import('./features/explore/ExplorePage')).ExplorePage }))
const LiquidityPage = lazy(async () => ({ default: (await import('./features/liquidity/LiquidityPage')).LiquidityPage }))

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
    return isPage(hash) ? hash : 'swap'
  }
  const [page, setPage] = useState<Page>(fromHash)
  const [tradeMode, setTradeMode] = useState<'swap' | 'limit'>('swap')
  const [orderContext, setOrderContext] = useState<TradeMarketContext>()
  const [walletOpen, setWalletOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<AssetSelection>()
  const { t, locale } = usePreferences()
  const m = workspaceMessages(locale), orders = orderMessages(locale)
  const [selectedToken, setSelectedToken] = useState<Address>()
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
    if (window.location.hash !== `#${next}`) window.history.pushState(null, '', `#${next}`)
  }
  useEffect(() => {
    const changed = (): void => {
      if (window.location.hash !== '#main') setPage(fromHash())
    }
    window.addEventListener('hashchange', changed)
    window.addEventListener('popstate', changed)
    return () => { window.removeEventListener('hashchange', changed); window.removeEventListener('popstate', changed) }
  }, [])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {t('skipMain')}
      </a>
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
          <div className="trade-intro">
            <div><span className="eyebrow">X LAYER · 196</span><h1>{m.trade}</h1></div>
            <a className="bridge-link" href="https://web3.okx.com/xlayer/bridge" target="_blank" rel="noreferrer" title={m.bridgeNote}>
              {m.bridge}<Icon name="external" size={14} />
            </a>
          </div>
          <Suspense fallback={<p role="status">{t('reading')}</p>}>
            <TradeWorkspace wallet={wallet} balances={currentBalances} active={page === 'swap'}
              balancesLoading={balances.isFetching && !balances.data} balancesError={balances.isError || network.isError}
              onConnect={() => setWalletOpen(true)} onCreatePool={() => navigate('pools')}
              activeMode={tradeMode} orderMarketContext={orderContext}
              orderModeControl={<WorkspaceTabs label={orders.modes} value={tradeMode} tabs={[{ id: 'swap', name: orders.swap }, { id: 'limit', name: orders.title }]} onChange={setTradeMode} />}
              renderOrderPanel={(context) => <LimitOrderPanel wallet={wallet} seed={context} active={page === 'swap'}
                onConnect={() => setWalletOpen(true)} onSwap={() => setTradeMode('swap')} onContextChange={setOrderContext} />} />
          </Suspense>
        </div>
        {primaryPage(page) === 'portfolio' ? (
          <Suspense fallback={<p className="content-page" role="status">{t('reading')}</p>}>
            <PortfolioPage wallet={wallet} onConnect={() => setWalletOpen(true)} onSwap={() => navigate('swap')}
              onPools={() => navigate('pools')} initialTab={portfolioTab(page)} selectedAsset={page === 'assets' ? selectedAsset : undefined}
              onTabChange={(tab) => navigate(PORTFOLIO_ROUTES[tab])} />
          </Suspense>
        ) : page === 'pools' ? (
          <Suspense fallback={<p className="content-page" role="status">{t('reading')}</p>}>
            <LiquidityPage wallet={wallet} onConnect={() => setWalletOpen(true)} onSwap={() => navigate('swap')} />
          </Suspense>
        ) : primaryPage(page) === 'explore' ? (
          <Suspense fallback={<p className="content-page" role="status">{t('reading')}</p>}>
            <ExplorePage wallet={wallet} onConnect={() => setWalletOpen(true)} onSwap={() => navigate('swap')}
              initialTab={exploreTab(page)} selectedToken={selectedToken} onTabChange={(tab) => navigate(EXPLORE_ROUTES[tab])} />
          </Suspense>
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
          onToken={(address) => { setSelectedToken(address); navigate('explore'); setSearchOpen(false) }}
          onReference={() => { navigate('reference'); setSearchOpen(false) }}
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
