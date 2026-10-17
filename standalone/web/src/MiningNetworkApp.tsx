import { useQuery } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { formatUnits } from 'viem'
import { PreferencesDialog } from './components/PreferencesDialog'
import { WalletDialog } from './components/WalletDialog'
import { Button, Icon, SodaMark, Surface } from './components/primitives'
import { miningNetworkMessages } from './i18n/mining-network'
import { shortenAddress } from './lib/address'
import { getProfileNetworkStatus } from './lib/networkStatus'
import { hexQuantity, rpc } from './lib/readRpc'
import { useWallet } from './lib/useWallet'
import { NETWORK } from './network'
import { usePreferences } from './preferences/context'
import { PreferencesProvider } from './preferences/PreferencesProvider'
import './mining-network.css'

export function MiningNetworkApp(): ReactElement {
  return <PreferencesProvider><MiningNetworkContent /></PreferencesProvider>
}

function MiningNetworkContent(): ReactElement {
  const { t, locale } = usePreferences(), m = miningNetworkMessages(locale)
  const wallet = useWallet()
  const [walletOpen, setWalletOpen] = useState(false), [preferencesOpen, setPreferencesOpen] = useState(false)
  const network = useQuery({ queryKey: ['network-profile', NETWORK.id], queryFn: getProfileNetworkStatus, retry: false, refetchInterval: 20_000 })
  const address = wallet.session?.chainId === NETWORK.chainId ? wallet.session.address : undefined
  const balance = useQuery({ queryKey: ['native-balance', NETWORK.id, address], enabled: !!address && network.isSuccess,
    queryFn: async () => hexQuantity(await rpc('eth_getBalance', [address!, 'latest'])), retry: false, refetchInterval: 20_000 })
  return <div className="app-shell">
    <a className="skip-link" href="#main">{t('skipMain')}</a>
    <header className="site-header mining-network-header">
      <div className="brand"><SodaMark decorative /><span>Soda<span className="brand-dex">DEX</span></span><span className="test-tag">TEST</span></div>
      <div className="header-actions">
        <Button onClick={() => setWalletOpen(true)}><Icon name="wallet" size={17} />{wallet.session ? shortenAddress(wallet.session.address) : t('connectWallet')}</Button>
        <Button appearance="icon" aria-label={t('preferences')} aria-haspopup="dialog" onClick={() => setPreferencesOpen(true)}><Icon name="settings" /></Button>
      </div>
    </header>
    <div className="test-notice"><span className="test-notice-label">TESTNET</span><p>{m.note}</p></div>
    <main id="main" tabIndex={-1} className="content-page mining-network-page">
      <p className="eyebrow">{NETWORK.chainName} · {NETWORK.chainId}</p><h1>{m.title}</h1>
      <Surface className="mining-network-status" aria-labelledby="mining-network-title">
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
      </Surface>
      <p className="dialog-note">{m.isolated}</p>
    </main>
    {walletOpen && <WalletDialog wallet={wallet} onClose={() => setWalletOpen(false)} />}
    {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}
  </div>
}
