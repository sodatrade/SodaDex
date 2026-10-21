import { formatBalance } from './format'
import { deploymentKey } from './config'
import { lazy, Suspense, useMemo, useState, useEffect, useCallback, type ReactElement } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type Address, type Hex } from 'viem'
import { useWallet } from '../lib/useWallet'
import { PreferencesProvider } from '../preferences/PreferencesProvider'
import { usePreferences } from '../preferences/context'
import { WalletDialog } from '../components/WalletDialog'
import { PreferencesDialog } from '../components/PreferencesDialog'
import { Button, SodaMark } from '../components/primitives'
import { shortenAddress } from '../lib/address'
import { NETWORK } from '../network'
import { deploymentState } from './config'
import { makeClient, readSnapshot, type PreparedTransaction } from './client'
import { messages } from './messages'
import { SwapScreen } from './SwapScreen'
import { PoolScreen } from './PoolScreen'
import { MineScreen } from './MineScreen'
import { MarketPanel } from './MarketPanel'
import { TransactionReview } from './TransactionReview'
import { TransientNotice } from './TransientNotice'
import './fragments.css'
const OrdinaryLiquidity = lazy(async () => ({ default: (await import('../features/liquidity/LiquidityPage')).LiquidityPage }))
const OrdinarySwap = lazy(async () => ({ default: (await import('./OrdinarySwap')).OrdinarySwap }))
type Tab = 'swap' | 'pool' | 'mine'
export function fragmentTab(hash: string): Tab { return ['#pool', '#pools'].includes(hash) ? 'pool' : ['#mine', '#portfolio', '#fragments', '#assets'].includes(hash) ? 'mine' : 'swap' }
export function FragmentApp(): ReactElement { return <PreferencesProvider><FragmentWorkspace /></PreferencesProvider> }
function FragmentWorkspace(): ReactElement {
  const [tab, setTab] = useState<Tab>(() => fragmentTab(location.hash)), [walletOpen, setWalletOpen] = useState(false), [preferencesOpen, setPreferencesOpen] = useState(false)
  const [transaction, setTransaction] = useState<PreparedTransaction>(), [preparing, setPreparing] = useState(false), [notice, setNotice] = useState({ message: '', id: 0 }), [success, setSuccess] = useState<Hex>()
  const setError = useCallback((message: string): void => setNotice(previous => ({ message, id: previous.id + 1 })), [])
  const dismissNotice = useCallback((): void => setNotice(previous => ({ ...previous, message: '' })), [])
  const [poolKind, setPoolKind] = useState<'ordinary' | 'miner'>('ordinary'), [ordinaryBusy, setOrdinaryBusy] = useState(false)
  const [swapKind, setSwapKind] = useState<'ordinary' | 'miner'>('ordinary'), [swapBusy, setSwapBusy] = useState(false)
  const [swapLoaded, setSwapLoaded] = useState(() => fragmentTab(location.hash) === 'swap' && NETWORK.dexEnabled)
  const [ordinaryLoaded, setOrdinaryLoaded] = useState(() => fragmentTab(location.hash) === 'pool' && NETWORK.dexEnabled)
  const wallet = useWallet(), { locale } = usePreferences(), m = messages(locale), cache = useQueryClient()
  const { deployment, error: configError } = useMemo(deploymentState, [])
  const client = useMemo(() => deployment ? makeClient(deployment) : undefined, [deployment])
  const account = wallet.session?.chainId === NETWORK.chainId ? wallet.session.address : undefined
  const snapshot = useQuery({ queryKey: ['fragment-snapshot', deploymentKey(deployment), account], enabled: !!deployment && !!client,
    queryFn: () => { if (!client || !deployment) throw new Error(m.notDeployed); return readSnapshot(client, deployment, account) }, refetchInterval: 15000, retry: false })
  useEffect(() => { if (tab === 'swap' && NETWORK.dexEnabled) setSwapLoaded(true) }, [tab])
  useEffect(() => { if (tab === 'pool' && NETWORK.dexEnabled) setOrdinaryLoaded(true) }, [tab])
  useEffect(() => {
    const changed = (): void => { setTab(fragmentTab(location.hash)); setTransaction(undefined); setError('') }
    window.addEventListener('hashchange', changed); window.addEventListener('popstate', changed)
    return () => { window.removeEventListener('hashchange', changed); window.removeEventListener('popstate', changed) }
  }, [setError])
  function navigate(next: Tab): void { if (preparing || transaction || ordinaryBusy || swapBusy) return; history.pushState(null, '', `#${next}`); setTab(next); setError(''); setSuccess(undefined) }
  function prepare(label: string, build: () => Promise<{to: Address; data: Hex; value?: bigint; label?: string}>): void {
    const identity = wallet.getIdentity()
    if (!identity || identity.chainId !== NETWORK.chainId || !client || !deployment) { setError(m.walletRequired); return }
    setPreparing(true); setError(''); setSuccess(undefined)
    void build().then(async tx => {
      await client.call({ account: identity.address, to: tx.to, data: tx.data, value: tx.value ?? 0n })
      if (wallet.getIdentity()?.revision !== identity.revision) throw new Error(m.walletChanged)
      setTransaction({ ...tx, value: tx.value ?? 0n, label: tx.label ?? label, account: identity.address, chainId: identity.chainId })
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : m.actionError)).finally(() => setPreparing(false))
  }
  return <div className="fragment-shell"><a className="skip-link" href="#main">Skip</a><header className="fragment-header"><button className="brand" aria-label="SodaDEX" onClick={() => navigate('swap')}><SodaMark decorative /><span>Soda<span className="brand-dex">DEX</span></span></button>
    <nav aria-label="SodaDEX">{(['swap', 'pool', 'mine'] as const).map(id => <button key={id} aria-current={tab === id ? 'page' : undefined} disabled={preparing || !!transaction || ordinaryBusy || swapBusy} onClick={() => navigate(id)}>{id === 'swap' ? m.dex : id === 'pool' ? m.pool : m.mine}</button>)}</nav>
    <div className="fragment-actions"><Button onClick={() => setPreferencesOpen(true)}>{m.settings}</Button><Button appearance="primary" onClick={() => setWalletOpen(true)}>{wallet.session ? shortenAddress(wallet.session.address) : m.connect}</Button></div></header>
    <div className="fragment-banner"><span>TEST · X Layer {NETWORK.chainId}</span><span>{m.test}</span></div>
    <main id="main" className="fragment-main"><div className="fragment-page-heading"><div><span className="eyebrow">X LAYER · SODADEX</span><h1>{tab === 'swap' ? m.swap : tab === 'pool' ? m.liquidity : m.mine}</h1></div><Button disabled={snapshot.isFetching} onClick={() => { void cache.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('fragment-') || ['liquidity', 'balances'].includes(String(q.queryKey[0])) }) }}>{m.retry}</Button></div>
      {wallet.session && !account && <Button onClick={() => { void wallet.switchChain() }}>{m.switchChain} · {NETWORK.chainId}</Button>}
      {tab === 'swap' && NETWORK.dexEnabled && <div className="fragment-pool-kinds" role="group" aria-label={m.marketType}><Button aria-pressed={swapKind === 'ordinary'} disabled={swapBusy || preparing || !!transaction} onClick={() => setSwapKind('ordinary')}>{m.allTokens}</Button><Button aria-pressed={swapKind === 'miner'} disabled={swapBusy || preparing || !!transaction} onClick={() => setSwapKind('miner')}>OKB / sFAB</Button></div>}
      {tab === 'pool' && NETWORK.dexEnabled && <div className="fragment-pool-kinds" role="group" aria-label={m.poolType}>
        <Button aria-pressed={poolKind === 'ordinary'} disabled={ordinaryBusy || preparing || !!transaction} onClick={() => setPoolKind('ordinary')}>{m.ordinaryPools}</Button>
        <Button aria-pressed={poolKind === 'miner'} disabled={ordinaryBusy || preparing || !!transaction} onClick={() => setPoolKind('miner')}>OKB / sFAB · {m.specialPool}</Button>
      </div>}
      <div hidden={NETWORK.dexEnabled && ((tab === 'pool' && poolKind === 'ordinary') || (tab === 'swap' && swapKind === 'ordinary'))}>
      <div className="fragment-overview">{snapshot.data && <><span>{m.reserves}</span><span>OKB <strong>{formatBalance(snapshot.data.okb)}</strong></span><span>sFAB <strong>{formatBalance(snapshot.data.shares)}</strong></span></>}</div>
      <div className={tab === 'swap' && deployment ? 'fragment-grid' : undefined}>{tab === 'swap' && deployment && <MarketPanel key={deploymentKey(deployment)} deployment={deployment} m={m} />}<div>
      {!deployment ? <section className="fragment-card"><p role="status">{m.notDeployed}</p>{configError && <p role="alert">{configError}</p>}</section> : snapshot.isPending ? <p role="status">{m.loading}</p> : snapshot.isError ? <section className="fragment-card"><p role="alert">{m.unavailable}</p><p>{snapshot.error.message}</p></section> : client && snapshot.data && <>

        {preparing && <p role="status">{m.loading}</p>}{success && <p role="status">{m.success} · <a target="_blank" rel="noreferrer" href={`${NETWORK.explorerUrl}/tx/${success}`}>{m.explorer} ↗</a></p>}
        <fieldset disabled={preparing || !!transaction} className="fragment-workspace">
          {tab === 'swap' ? <SwapScreen client={client} deployment={deployment} snapshot={snapshot.data} account={account} m={m} prepare={prepare} /> : tab === 'pool' ? <PoolScreen busy={preparing || !!transaction} client={client} deployment={deployment} snapshot={snapshot.data} account={account} m={m} prepare={prepare} /> : <MineScreen key={account ?? 'none'} client={client} deployment={deployment} snapshot={snapshot.data} account={account} m={m} prepare={prepare} />}
        </fieldset>
      </>}</div></div></div>
      {swapLoaded && <div hidden={tab !== 'swap' || swapKind !== 'ordinary'}><Suspense fallback={<p role="status">{m.loading}</p>}><OrdinarySwap active={tab === 'swap' && swapKind === 'ordinary'} wallet={wallet} onConnect={() => setWalletOpen(true)} onBusyChange={setSwapBusy} onCreatePool={() => { setPoolKind('ordinary'); navigate('pool') }} /></Suspense></div>}
      {ordinaryLoaded && <div hidden={tab !== 'pool' || poolKind !== 'ordinary'}><Suspense fallback={<p role="status">{m.loading}</p>}><OrdinaryLiquidity embedded wallet={wallet} onConnect={() => setWalletOpen(true)} onBusyChange={setOrdinaryBusy} /></Suspense></div>}
    </main>{notice.message && <TransientNotice message={notice.message} id={notice.id} onDismiss={dismissNotice} />}{walletOpen && <WalletDialog wallet={wallet} onClose={() => setWalletOpen(false)} />}{preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}
    {transaction && client && deployment && <TransactionReview tx={transaction} client={client} deployment={deployment} wallet={wallet} m={m} onClose={() => setTransaction(undefined)} onSuccess={hash => { setSuccess(hash); setTransaction(undefined); void cache.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('fragment-') }) }} />}
  </div>
}
