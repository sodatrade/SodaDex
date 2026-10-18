import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { formatUnits } from 'viem'
import { Header } from './components/Header'
import { miningMessages } from './mining/messages'
import { onlineMessages } from './mining/onlineMessages'
import { miningTab, type MiningTab } from './mining/navigation'
import { PreferencesDialog } from './components/PreferencesDialog'
import { WalletDialog } from './components/WalletDialog'
import { Button, Icon, Surface } from './components/primitives'
import { miningNetworkMessages } from './i18n/mining-network'
import { getProfileNetworkStatus } from './lib/networkStatus'
import { hexQuantity, rpc } from './lib/readRpc'
import { useWallet } from './lib/useWallet'
import { NETWORK } from './network'
import { MiningBaseStatus } from './mining/MiningBaseStatus'
import { MINING_PRODUCTS } from '../../mining-products'
import { MiningProductsWorkspace } from './mining/ProductsWorkspace'
import { usePreferences } from './preferences/context'
import { PreferencesProvider } from './preferences/PreferencesProvider'
import './workspace.css'
import './mining-network.css'

export function MiningNetworkApp(): ReactElement {
  return <PreferencesProvider><MiningNetworkContent /></PreferencesProvider>
}

function MiningNetworkContent(): ReactElement {
  const { t, locale } = usePreferences(), m = miningNetworkMessages(locale)
  const wallet = useWallet(), messages = miningMessages(locale), online = onlineMessages(locale)
  const [tab, setTab] = useState<MiningTab>(() => miningTab(window.location.hash)), [busy, setBusy] = useState(false)
  const navigate = useCallback((next: MiningTab): void => {
    if (busy) return
    setTab(next)
    if (window.location.hash !== `#${next}`) window.history.pushState(null, '', `#${next}`)
  }, [busy])
  useEffect(() => {
    const changed = (): void => {
      if (window.location.hash === '#main') return
      if (busy) { window.history.replaceState(null, '', `#${tab}`); return }
      setTab(miningTab(window.location.hash))
    }
    const leaving = (event: BeforeUnloadEvent): void => { if (busy) event.preventDefault() }
    window.addEventListener('hashchange', changed); window.addEventListener('popstate', changed)
    window.addEventListener('beforeunload', leaving)
    return () => {
      window.removeEventListener('hashchange', changed); window.removeEventListener('popstate', changed)
      window.removeEventListener('beforeunload', leaving)
    }
  }, [busy, tab])
  const title = tab === 'launch' || tab === 'automation' ? online[tab] : messages[tab]
  const [walletOpen, setWalletOpen] = useState(false), [preferencesOpen, setPreferencesOpen] = useState(false)
  const network = useQuery({ queryKey: ['network-profile', NETWORK.id], queryFn: getProfileNetworkStatus, retry: false, refetchInterval: 20_000 })
  const address = wallet.session?.chainId === NETWORK.chainId ? wallet.session.address : undefined
  const balance = useQuery({ queryKey: ['native-balance', NETWORK.id, address], enabled: !!address && network.isSuccess,
    queryFn: async () => hexQuantity(await rpc('eth_getBalance', [address!, 'latest'])), retry: false, refetchInterval: 20_000 })
  return <div className="app-shell">
    <a className="skip-link" href="#main">{t('skipMain')}</a>
    <Header page="swap" miningPage={tab} navigationDisabled={busy} onMiningPageChange={navigate}
      onPageChange={(page) => { window.location.assign(`${import.meta.env.BASE_URL === '/mining/' ? '/' : 'https://sodadex-preview.jsmsdx2025.workers.dev/'}#${page}`) }}
      wallet={wallet} onWallet={() => setWalletOpen(true)} onPreferences={() => setPreferencesOpen(true)} />
    <div className="test-notice"><span className="test-notice-label">TESTNET</span><p>{m.note}</p></div>
    <main id="main" tabIndex={-1} className="content-page mining-network-page">
      <div className="page-heading mining-heading"><div><p className="eyebrow">FAB · {NETWORK.chainName} · {NETWORK.chainId}</p>
        <h1>{MINING_PRODUCTS.state === 'ready' ? title : m.title}</h1><p>{tab === 'fragments' ? m.fragmentsIntro : m.fundraisingIntro}</p></div>
        <span className="mining-chain-chip"><Icon name="layers" size={15} />1952 · TESTNET</span></div>
      {!wallet.session ? <div className="mining-wallet-prompt"><span>{messages.connect}</span><Button onClick={() => setWalletOpen(true)}>{t('connectWallet')}</Button></div>
        : wallet.session.chainId !== 1952 ? <div className="mining-wallet-prompt" role="status"><span>{messages.miningWrongNetwork}</span>
          <Button appearance="primary" disabled={wallet.status !== 'idle'} onClick={() => void wallet.switchChain()}>{m.switchTestnet}</Button></div> : null}
      {wallet.error && <p role="alert">{t(wallet.error)}</p>}
      {MINING_PRODUCTS.state === 'ready' ? <MiningProductsWorkspace deployment={MINING_PRODUCTS} wallet={wallet} activeTab={tab} onTabChange={navigate} onBusyChange={setBusy} /> : <Surface className="mining-network-status" aria-labelledby="mining-network-title">
        <h2 id="mining-network-title">{m.pending}</h2><p>{m.detail}</p>
        <dl className="review-details">
          <div><dt>{m.network}</dt><dd>{NETWORK.chainName} · {NETWORK.chainId}</dd></div>
          <div><dt>{m.contract}</dt><dd>{m.pending}</dd></div>
          <div><dt>{m.balance}</dt><dd>{!address ? '—' : balance.data === undefined ? '—' : `${formatUnits(balance.data, 18)} OKB`}</dd></div>
        </dl>
        <p role="status">{network.isPending ? t('networkLoading') : network.isError ? t('networkUnavailable') : `${t('networkConnected')} · #${network.data.block}`}</p>
        {network.isError && <Button disabled={network.isFetching} onClick={() => void network.refetch()}>{t('retry')}</Button>}
        {!wallet.session && <p>{m.wallet}</p>}
        {wallet.session && !address && <Button appearance="primary" disabled={wallet.status !== 'idle'} onClick={() => void wallet.switchChain()}>{t('switchNetwork')}</Button>}
        {balance.isError && <p role="alert">{t('networkUnavailable')}</p>}
      </Surface>}
      {MINING_PRODUCTS.state === 'ready' ? <details className="mining-base-disclosure"><summary>{m.baseAddresses}</summary>
        <MiningBaseStatus block={network.isSuccess ? network.data.block : undefined} account={address} /></details>
        : <MiningBaseStatus block={network.isSuccess ? network.data.block : undefined} account={address} />}
      <p className="dialog-note">{m.isolated}</p>
    </main>
    <footer className="site-footer"><div className={`rpc-status${network.isError ? ' status-error' : ''}`} role="status"><span className="status-dot" />
      <span>X Layer 1952 · {network.isPending ? t('networkLoading') : network.isError ? t('networkUnavailable') : t('networkConnected')}</span></div>
      <a href="https://github.com/sodatrade/SodaDex" target="_blank" rel="noreferrer">GitHub<Icon name="external" size={13} /></a></footer>
    {walletOpen && <WalletDialog wallet={wallet} onClose={() => setWalletOpen(false)} />}
    {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}
  </div>
}
