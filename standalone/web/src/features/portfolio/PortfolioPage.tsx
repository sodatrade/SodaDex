import './portfolio.css'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactElement } from 'react'
import type { AssetSelection } from '../../components/AssetPage'
import { Button, Icon, Surface } from '../../components/primitives'
import { formatBalance } from '../../domain/amount'
import { CHAIN_ID, shortenAddress } from '../../domain/assets'
import { workspaceMessages } from '../../i18n/workspace'
import type { WalletController } from '../../lib/useWallet'
import { listPositions } from '../../liquidity'
import { usePreferences } from '../../preferences/context'
import { HistoryPage, type HistoryScope } from '../history/HistoryPage'
import { JOURNAL_CHANGED, readTransactions } from '../history/journal'
import { WorkspaceTabs } from '../workspace/WorkspaceTabs'
import { BalanceTable } from './BalanceTable'
import { PortfolioPositions } from './PortfolioPositions'
import { ReceiveDialog } from './ReceiveDialog'
import { SendDialog } from './SendDialog'
import { usePortfolioTokens, type PortfolioToken } from './usePortfolioTokens'
export type PortfolioTab = 'overview' | 'tokens' | 'nfts' | 'activity'
interface Props {
  wallet: WalletController; onConnect: () => void; onSwap: () => void; onPools: () => void
  initialTab?: PortfolioTab; onTabChange?: (tab: PortfolioTab) => void; selectedAsset?: AssetSelection
}
export function PortfolioPage({ wallet, onConnect, onSwap, onPools, initialTab = 'overview', selectedAsset, onTabChange }: Props): ReactElement {
  const { locale } = usePreferences(), m = workspaceMessages(locale), queryClient = useQueryClient()
  const [tab, setTab] = useState<PortfolioTab>(initialTab), [receive, setReceive] = useState(false), [send, setSend] = useState<PortfolioToken>()
  const [activityScope, setActivityScope] = useState<HistoryScope>('mine'), [, setJournalRevision] = useState(0)
  const account = wallet.session?.chainId === CHAIN_ID ? wallet.session.address : undefined
  const tokens = usePortfolioTokens(account)
  const positions = useQuery({ queryKey: ['liquidity', 'positions', account], queryFn: () => listPositions(account!),
    enabled: !!account, retry: false, refetchInterval: 30_000 })
  useEffect(() => { setTab(initialTab) }, [initialTab])
  useEffect(() => { if (selectedAsset) setTab('tokens') }, [selectedAsset])
  useEffect(() => {
    const changed = (): void => setJournalRevision((v) => v + 1)
    window.addEventListener(JOURNAL_CHANGED, changed); window.addEventListener('storage', changed)
    return () => { window.removeEventListener(JOURNAL_CHANGED, changed); window.removeEventListener('storage', changed) }
  }, [])
  const native = tokens.data?.tokens.find((token) => token.currency.native)
  const pending = account ? readTransactions(account).filter((r) => r.status === 'pending').length : undefined
  const refresh = (): void => {
    for (const key of ['portfolio-tokens', 'liquidity', 'dex-events']) void queryClient.invalidateQueries({ queryKey: [key] })
  }
  const changeTab = (next: PortfolioTab): void => { setTab(next); onTabChange?.(next) }
  const assetTokens = tokens.data?.tokens ?? []
  const sendToken = native?.balance && native.balance > 0n ? native : assetTokens.find((token) => token.balance !== undefined && token.balance > 0n)
  return <section className="content-page portfolio-page" aria-labelledby="portfolio-title">
    <div className="portfolio-heading"><div className="page-heading"><h1 id="portfolio-title">{m.portfolioTitle}</h1>
      <p>{m.portfolioNote}</p>{account && <span className="portfolio-account">X Layer · {shortenAddress(account)}</span>}</div>
      <Button appearance="ghost" onClick={refresh} disabled={!account || tokens.isFetching || positions.isFetching}><Icon name="refresh" size={17} />{m.refresh}</Button></div>
    <WorkspaceTabs label={m.portfolio} value={tab} tabs={(['overview', 'tokens', 'nfts', 'activity'] as const).map((id) => ({ id, name: m[id] }))} onChange={changeTab} />
    {!account && <Surface className="portfolio-connect"><Icon name="wallet" size={32} /><p>{m.portfolioNote}</p>
      <Button appearance="primary" onClick={wallet.session ? () => void wallet.switchChain() : onConnect}>{wallet.session ? m.wrongChain : m.connect}</Button></Surface>}
    {account && <div className="portfolio-panel" role="tabpanel" aria-label={m[tab]}>
      {tab === 'overview' && <>
        <div className="portfolio-summary"><Surface><span>{m.nativeBalance}</span><strong className="numeric">{native?.balance === undefined ? '—' : formatBalance(native.balance, 18)} <small>OKB</small></strong></Surface>
          <Surface><span>{m.positions}</span><strong className="numeric">{positions.data ? positions.data.length : '—'}</strong></Surface>
          <Surface><span>{m.pending}</span><button className="portfolio-pending numeric" onClick={() => { setActivityScope('local'); changeTab('activity') }}>{pending ?? '—'}<Icon name="external" size={16} /></button></Surface></div>
        <div className="portfolio-actions"><Button appearance="primary" onClick={() => { if (sendToken) setSend(sendToken) }} disabled={!sendToken}>{m.send}</Button>
          <Button onClick={() => setReceive(true)}>{m.receive}</Button><Button onClick={onSwap}>{m.swap}</Button><Button onClick={onPools}>{m.createPosition}</Button></div>
        <p className="portfolio-muted">{m.noFiat}</p>
        <div className="portfolio-section-heading"><h2>{m.tokens}</h2><Button appearance="ghost" onClick={() => changeTab('tokens')}>{m.tokens}<Icon name="chevron" size={16} /></Button></div>
        <BalanceTable key={account.toLowerCase()} tokens={assetTokens} onSend={setSend} />
      </>}
      {tab === 'tokens' && <><p className="portfolio-muted">{m.noFiat}</p><BalanceTable key={account.toLowerCase()} tokens={assetTokens} onSend={setSend} selected={selectedAsset} /></>}
      {(tab === 'overview' || tab === 'tokens') && <>
        {tokens.isFetching && <p role="status" className="portfolio-muted">{m.loading}</p>}
        {tokens.isError && <p role="alert" className="error-text">{m.unavailable} <Button onClick={() => void tokens.refetch()}>{m.retry}</Button></p>}
        {!!tokens.data?.metadataFailures && <p role="status" className="portfolio-muted">{m.metadataReadFailures}</p>}
        {assetTokens.some((token) => token.balance === undefined) && <p role="status" className="portfolio-muted">{m.balanceReadFailures}</p>}
      </>}
      {tab === 'nfts' && <>
        {positions.isFetching && <p role="status">{m.loading}</p>}
        {positions.isError && <p role="alert" className="error-text">{m.unavailable} <Button onClick={() => void positions.refetch()}>{m.retry}</Button></p>}
        {positions.data?.length === 0 && <div className="portfolio-empty"><p>{m.noPositions}</p><Button onClick={onPools}>{m.createPosition}</Button></div>}
        {positions.data && <PortfolioPositions key={account.toLowerCase()} positions={positions.data} onManage={onPools} />}
      </>}
      {tab === 'overview' && positions.isError && <p role="status" className="portfolio-muted">{m.positions}: {m.unavailable}</p>}
      {tab === 'activity' && <><p className="portfolio-muted">{m.activityScopeNote}</p><HistoryPage wallet={wallet} onConnect={onConnect} initialScope={activityScope} scopes={['mine', 'local']} embedded /></>}
    </div>}
    {receive && account && <ReceiveDialog address={account} onClose={() => setReceive(false)} />}
    {send && <SendDialog token={send} wallet={wallet} onClose={() => setSend(undefined)} />}
  </section>
}
