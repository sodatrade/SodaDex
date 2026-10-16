import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactElement } from 'react'
import { AssetPage } from './components/AssetPage'
import { Header, type Page } from './components/Header'
import { PoolsPage } from './components/PoolsPage'
import { Button, Icon, SodaMark } from './components/primitives'
import { SwapCard } from './components/SwapCard'
import { WalletDialog } from './components/WalletDialog'
import { CHAIN_ID } from './domain/assets'
import { getBalances, getNetworkStatus } from './lib/rpc'
import { useWallet } from './lib/useWallet'

export function App(): ReactElement {
  const [page, setPage] = useState<Page>('swap')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [walletOpen, setWalletOpen] = useState(false)
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        跳转至主要内容
      </a>
      <div className="ambient" aria-hidden="true">
        <div className="ambient-halo" />
        <div className="ambient-grid" />
      </div>
      <Header
        page={page}
        onPageChange={setPage}
        wallet={wallet}
        onWallet={() => setWalletOpen(true)}
        theme={theme}
        onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      />
      <div className="test-notice">
        <span className="test-notice-label">测试体验</span>
        <p>
          X Layer 主网 <span className="notice-chain-id">196</span> · 使用真实 OKB · 兑换暂未开放
        </p>
      </div>
      <main id="main" tabIndex={-1}>
        {page === 'swap' ? (
          <div className="trade-layout">
            <section className="hero-copy" aria-labelledby="hero-heading">
              <div className="eyebrow">
                <span />
                BUILT FOR X LAYER
              </div>
              <h1 id="hero-heading">
                让流动发生<span className="hero-period">。</span>
                <br />
                <span className="hero-line-two">让交易轻盈。</span>
              </h1>
              <p className="hero-description">
                属于 SodaDex 的全新链上体验。
                <br />
                从连接钱包开始，简单、直接。
              </p>
              <div className="hero-details">
                <span>原生 OKB</span>
                <span>V3 + V4</span>
                <span>低费率测试</span>
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
                一切，从一笔流动开始<span>01 / SWAP</span>
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
                  V3 / V4 测试部署准备中
                </span>
                <span>平台费 0%</span>
              </div>
            </div>
          </div>
        ) : page === 'assets' ? (
          <AssetPage
            balances={currentBalances}
            connected={!!wallet.session && correctChain}
            loading={balances.isFetching && !balances.data}
            error={!!wallet.session && (balances.isError || network.isError)}
          />
        ) : (
          <PoolsPage onSwap={() => setPage('swap')} />
        )}
      </main>
      <footer className="site-footer">
        <div className={`rpc-status${network.isError ? ' status-error' : ''}`} role="status">
          <span className="status-dot" />
          <span>{network.isPending ? '正在连接 X Layer…' : network.isError ? '节点暂不可用' : 'X Layer 已连接'}</span>
          {network.data && <span className="block-number">#{network.data.block.toString()}</span>}
          {network.isError && (
            <Button appearance="ghost" onClick={() => void network.refetch()} disabled={network.isFetching}>
              <Icon name="refresh" size={14} />
              重试
            </Button>
          )}
        </div>
        <div className="footer-brand">
          <SodaMark decorative />
          <span>
            SodaDex <span>·</span> A little more flow.
          </span>
        </div>
        <a href="https://github.com/sodatrade/SodaDex" target="_blank" rel="noreferrer">
          GitHub
          <Icon name="external" size={13} />
        </a>
      </footer>
      {walletOpen && <WalletDialog wallet={wallet} onClose={() => setWalletOpen(false)} />}
    </div>
  )
}
