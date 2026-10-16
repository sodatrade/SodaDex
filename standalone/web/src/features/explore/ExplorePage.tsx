import { useEffect, useState, type ReactElement } from 'react'
import type { Address } from 'viem'
import { Button } from '../../components/primitives'
import { exploreMessages } from '../../i18n/explore'
import type { WalletController } from '../../lib/useWallet'
import { usePreferences } from '../../preferences/context'
import { HistoryPage } from '../history/HistoryPage'
import { MarketPage } from '../market/MarketPage'
import { ReferencePoolsPanel } from './ReferencePoolsPanel'
import { TokenDetail } from './TokenDetail'
import { TokenList } from './TokenList'
import './explore.css'
export type ExploreTab = 'tokens' | 'pools' | 'transactions' | 'reference'
export interface ExplorePageProps {
  wallet: WalletController; onConnect: () => void; onSwap: () => void; initialTab?: ExploreTab; selectedToken?: Address; onTabChange?: (tab: ExploreTab) => void
}
export function ExplorePage({ wallet, onConnect, initialTab = 'tokens', selectedToken, onTabChange }: ExplorePageProps): ReactElement {
  const { locale } = usePreferences(), m = exploreMessages(locale)
  const [tab, setTab] = useState<ExploreTab>(initialTab), [token, setToken] = useState<Address | undefined>(selectedToken)
  useEffect(() => { setTab(initialTab); setToken(selectedToken) }, [initialTab, selectedToken])
  return <section className="content-page explore" aria-labelledby="explore-title">
    <div className="page-heading"><span className="eyebrow">EXPLORE / X LAYER</span><h1 id="explore-title">{m.title}</h1><p>{m.note}</p></div>
    <nav className="explore-tabs" aria-label={m.title}>{(['tokens', 'pools', 'transactions', 'reference'] as const).map(value =>
      <Button key={value} aria-pressed={tab === value} onClick={() => { setTab(value); setToken(undefined); onTabChange?.(value) }}>{m[value]}</Button>)}</nav>
    {tab === 'tokens' && (token ? <TokenDetail key={token} address={token} wallet={wallet} onConnect={onConnect} onBack={() => setToken(undefined)} /> : <TokenList onToken={setToken} />)}
    {tab === 'pools' && <><p className="explore-note">{m.ownNote}</p><MarketPage /></>}
    {tab === 'transactions' && <><p className="explore-note">{m.ownNote}</p><HistoryPage wallet={wallet} onConnect={onConnect} /></>}
    {tab === 'reference' && <ReferencePoolsPanel />}
  </section>
}
