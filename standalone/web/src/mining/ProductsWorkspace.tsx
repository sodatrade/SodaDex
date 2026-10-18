import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { formatUnits } from 'viem'
import type { MiningAddress, MiningProductDeployment } from '../../../mining-products'
import { Dialog } from '../components/Dialog'
import { Button, Icon } from '../components/primitives'
import { NETWORK } from '../network'
import { shortenAddress } from '../lib/address'
import { formatBalance } from '../domain/amount'
import { hexQuantity, rpc } from '../lib/readRpc'
import type { WalletController } from '../lib/useWallet'
import { usePreferences } from '../preferences/context'
import { miningTab, MINING_TABS, type MiningTab } from './navigation'
import { MiningActionWorkspace } from './ActionWorkspace'
import { AutomationPanel } from './AutomationPanel'
import { executeMiningCall, type MiningStage } from './execution'
import { MiningHistoryPanel } from './HistoryPanel'
import { loadMiningJournal, saveMiningSubmission, type MiningSubmission } from './journal'
import { LaunchProjectPanel } from './LaunchProjectPanel'
import { miningMessages, type MiningMessageKey } from './messages'
import { onlineMessages } from './onlineMessages'
import { buildMiningPlan, type MiningAction, type MiningPlan } from './plans'
import { miningUint, productRead, verifyMiningDeployment } from './protocol'
import { MiningRewardsPanel } from './RewardsPanel'
import { useOnlineCatalog } from './useOnlineCatalog'

export function MiningProductsWorkspace({ deployment: base, wallet, activeTab, onTabChange, onBusyChange, onConnect }: { deployment: MiningProductDeployment; wallet: WalletController; activeTab?: MiningTab; onTabChange?: (tab: MiningTab) => void; onBusyChange?: (busy: boolean) => void; onConnect?: () => void }): ReactElement {
  const { locale } = usePreferences(), m = miningMessages(locale), online = onlineMessages(locale), client = useQueryClient()
  const [localTab, setLocalTab] = useState<MiningTab>(() => miningTab(window.location.hash))
  const tab = activeTab ?? localTab
  const setTab = (next: MiningTab): void => { setLocalTab(next); onTabChange?.(next) }
  const [projectToken, setProjectToken] = useState<MiningAddress | undefined>(base.projects[0]?.token.address), [plan, setPlan] = useState<MiningPlan>()
  const catalog = useOnlineCatalog(base, projectToken), d = catalog.deployment
  const [completed, setCompleted] = useState<MiningSubmission>()
  const [stage, setStage] = useState<MiningStage>(), [error, setError] = useState<MiningMessageKey>()
  const [busy, setBusy] = useState(false), [storageFailed, setStorageFailed] = useState(false)
  const [entries, setEntries] = useState(() => loadMiningJournal(d)), activePlan = useRef<MiningPlan | undefined>(undefined)
  const inFlight = useRef(false)
  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])
  const project = d.projects.find((p) => p.token.address.toLowerCase() === projectToken?.toLowerCase()) ?? d.projects[0]
  const account = wallet.session?.chainId === 1952 ? wallet.session.address : undefined
  const ready = useQuery({ queryKey: ['mining-ready', d.version, catalog.revision], queryFn: async () => { await verifyMiningDeployment(rpc, d); return true }, retry: false, refetchInterval: 30_000 })
  const paused = useQuery({ queryKey: ['mining-paused', d.version], enabled: ready.isSuccess,
    queryFn: () => productRead(rpc, d.contracts.mining.address, 'mining', 'paused'), retry: false, refetchInterval: 15_000 })
  const native = useQuery({ queryKey: ['native-balance', '1952-mining-test', account], enabled: ready.isSuccess && !!account,
    queryFn: async () => hexQuantity(await rpc('eth_getBalance', [account!, 'latest'])), retry: false, refetchInterval: 20_000 })
  const protection = useQuery({ queryKey: ['mining-protection', d.version, catalog.revision, project?.token.address], enabled: ready.isSuccess && !!project,
    queryFn: async () => ({ active: await productRead(rpc, project!.token.address, 'projectToken', 'protectionActive'),
      until: miningUint(await productRead(rpc, project!.token.address, 'projectToken', 'protectionEndsAt')) }), retry: false, refetchInterval: 15_000 })
  const balances = useQuery({ queryKey: ['mining-balances', d.version, catalog.revision, account, project?.token.address], enabled: ready.isSuccess && !!account,
    queryFn: async () => Promise.all([
      productRead(rpc, d.contracts.fab.address, 'fab', 'balanceOf', [account!]),
      productRead(rpc, d.contracts.fragmentVault.address, 'fragmentVault', 'balanceOf', [account!]),
      productRead(rpc, d.contracts.fragmentPool.address, 'fragmentPool', 'balanceOf', [account!]),
      ...(project ? [productRead(rpc, project.token.address, 'projectToken', 'balanceOf', [account!])] : []),
      ...(project?.pair ? [productRead(rpc, project.pair.address, 'pair', 'balanceOf', [account!])] : []),
    ]).then((values) => values.map(miningUint)), retry: false, refetchInterval: 15_000 })
  const disabled = !ready.isSuccess || !account || busy
  const update = (entry: MiningSubmission): void => {
    setEntries((old) => [...old.filter((r) => r.hash !== entry.hash), entry].slice(-100))
    try { saveMiningSubmission(d, entry) } catch { setStorageFailed(true) }
  }
  const failure = (cause: unknown): void => {
    const code = cause instanceof Error ? cause.message : ''
    setError(code in m ? code as MiningMessageKey : 'failed')
  }
  const selectPlan = (value: MiningPlan): void => { activePlan.current = value; setPlan(value); setError(undefined); setStage(undefined); setCompleted(undefined) }
  const preview = async (action: MiningAction, amount: string, second: string, slip: number): Promise<void> => {
    if (!account || busy) return
    setBusy(true)
    setError(undefined); setCompleted(undefined)
    try { selectPlan(await buildMiningPlan({ deployment: d, read: rpc, account, project, action, amount, secondAmount: second, slippageBps: slip })) }
    catch (cause) { failure(cause) }
    finally { setBusy(false) }
  }
  const submit = async (): Promise<void> => {
    const identity = wallet.getIdentity(), pending = plan
    if (!identity || !pending || inFlight.current) return
    inFlight.current = true
    setBusy(true); setError(undefined)
    let result: MiningSubmission | undefined
    try {
      for (const call of pending.calls) await executeMiningCall({ deployment: d, identity, getIdentity: wallet.getIdentity,
        isCurrent: () => activePlan.current === pending, read: rpc, onStage: setStage, onSubmission: (entry) => { update(entry); if (!entry.approval && entry.status === 'success') result = entry } }, call.tx, pending.action, call.approval)
      setCompleted(result); setPlan(undefined); activePlan.current = undefined
      await client.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('mining-') })
    } catch (cause) { failure(cause) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <div className="mining-workspace">
    <div className="mining-workspace-toolbar">
    <nav className="mining-tabs" aria-label={m.ready}>{MINING_TABS.map((name) =>
      <Button disabled={busy} appearance={tab === name ? 'primary' : 'ghost'} aria-current={tab === name ? 'page' : undefined} key={name} onClick={() => setTab(name)}>{name === 'launch' || name === 'automation' ? online[name] : m[name]}</Button>)}</nav>
    <div className="mining-workspace-bar"><span className={`mining-readiness${ready.isSuccess ? ' verified' : ''}`} role="status">
      {ready.isPending ? m.verifying : ready.isSuccess ? m.verified : m.versionError}</span>
      <Button appearance="ghost" disabled={ready.isFetching || busy} onClick={() => void client.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('mining-') })}><Icon name="refresh" size={14} />{m.refresh}</Button></div>
    </div>
    {catalog.unavailable && <p className="dialog-note" role="status">{online.serviceUnavailable}</p>}
    {account && balances.data && <details className="mining-wallet-assets"><summary><span><Icon name="wallet" size={16} />{m.balance}</span><span className="mining-wallet-summary"><strong>{formatBalance(balances.data[0], 8)} TEST-FAB</strong><span>{m.allAssets}</span><Icon name="chevron" size={14} /></span></summary><dl className="mining-balances">
      <div><dt><img className="mining-native-icon" src="/assets/okb.png" alt="" />TEST-OKB</dt><dd title={native.data === undefined ? undefined : formatUnits(native.data, 18)}>{native.data === undefined ? '—' : formatBalance(native.data, 18)}</dd></div>
      {[['TEST-FAB', 8], ['TEST-fFAB', 18], ['TEST-fFAB LP', 18], ...(project ? [[project.symbol, 18]] : []), ...(project?.pair ? [[`${project.symbol} LP`, 18]] : [])].map(([symbol, decimals], index) =>
        <div key={String(symbol)}><dt>{symbol}</dt><dd title={formatUnits(balances.data[index], Number(decimals))}>{formatBalance(balances.data[index], Number(decimals))}</dd></div>)}
    </dl></details>}
    {(tab === 'fundraising' || tab === 'positions') && !!d.projects.length && <div className="mining-project-select">
      <label htmlFor="mining-project">{m.selectProject}</label><select id="mining-project" value={project?.token.address} disabled={busy} onChange={(e) => setProjectToken(e.target.value as MiningAddress)}>
        {d.projects.map((p) => <option key={p.token.address} value={p.token.address}>{p.symbol}</option>)}</select></div>}
    {paused.data === true && <p className="mining-pause-note" role="status">{m.sourcePaused}</p>}
    {(tab === 'fundraising' || tab === 'positions') && protection.data?.active === true && <p className="mining-pause-note" role="status">{m.protectionUntil} {new Date(Number(protection.data.until) * 1000).toLocaleString(locale)} · {m.protectionNote}</p>}
    {completed && completed.from.toLowerCase() === account?.toLowerCase() && !plan && tab !== 'history' && <div className="mining-feedback" role="status"><Icon name="check" size={18} /><span>{m.miningSuccess}</span><a href={`${NETWORK.explorerUrl}/tx/${completed.hash}`} target="_blank" rel="noreferrer" title={completed.hash}>{shortenAddress(completed.hash)}<Icon name="external" size={13} /></a>
      <Button appearance="ghost" disabled={busy} onClick={() => setTab('history')}>{m.viewHistory}<Icon name="arrow" size={14} /></Button></div>}
    {error && !plan && <p className="mining-pause-note" role="alert">{m[error]}</p>}
    {tab === 'fundraising' && (project ? <MiningActionWorkspace key={`fundraising:${project.token.address}`} kind="fundraising"
      symbol={project.symbol} hasPair={!!project.pair} disabled={disabled || paused.data !== false} busy={busy} onConnect={onConnect} onPreview={preview} /> : <p>{m.noProjects}</p>)}
    {tab === 'fragments' && <MiningActionWorkspace key="fragments" kind="fragments" listingId={d.testListingIds?.[0]}
      disabled={disabled || paused.data !== false} busy={busy} onConnect={onConnect} onPreview={preview} />}
    {tab === 'positions' && <MiningRewardsPanel deployment={d} project={project} account={account} disabled={disabled} onPlan={selectPlan} />}
    {tab === 'history' && <MiningHistoryPanel account={account} entries={entries} onUpdate={update} />}
    {tab === 'launch' && <LaunchProjectPanel deployment={d} wallet={wallet} disabled={disabled} onBusy={setBusy} onSubmission={update}
      onRegistered={(registered) => { catalog.accept(registered); setProjectToken(registered.project.token.address); setTab('fundraising') }} />}
    {tab === 'automation' && <AutomationPanel deployment={d} token={project?.token.address} disabled={!ready.isSuccess || busy} />}
    {storageFailed && <p role="alert">{m.storageFailed} {entries.at(-1)?.hash}</p>}
    {plan && <Dialog title={m.review} description={m.testOnly} onEscape={() => busy} onClose={() => { if (!busy) { setPlan(undefined); activePlan.current = undefined } }}>
      <p className="mining-review-action">{plan.action in m ? m[plan.action as MiningMessageKey] : plan.action}</p>
      <dl className="review-details">{plan.details.map((row, index) => <div key={index}><dt>{m[row.label]}</dt><dd>{row.value}</dd></div>)}
        <div><dt>{m.transactions}</dt><dd>{plan.calls.length}</dd></div>
        {plan.block > 0n && <div><dt>{m.block}</dt><dd>#{plan.block.toString()}</dd></div>}
      </dl>
      {stage && <p role="status">{m[stage]}</p>}{error && <p role="alert">{m[error]}</p>}
      <div className="mining-button-row"><Button appearance="primary" disabled={busy || disabled || error === 'miningPending' || error === 'miningSubmissionUnknown'} onClick={() => void submit()}>{m.confirm}</Button>
        <Button disabled={busy} onClick={() => { setPlan(undefined); activePlan.current = undefined }}>{m.cancel}</Button></div>
    </Dialog>}
  </div>
}
