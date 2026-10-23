// Isolated visual fixture: no wallet discovery, network forwarding, signing or broadcast.
import '../../src/styles.css'
import '../../src/workspace.css'
import '../../src/mining-network.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Hex } from 'viem'
import { Header } from '../../src/components/Header'
import { PreferencesDialog } from '../../src/components/PreferencesDialog'
import { Icon } from '../../src/components/primitives'
import type { WalletController } from '../../src/lib/useWallet'
import { MiningProductsWorkspace } from '../../src/mining/ProductsWorkspace'
import { miningMessages } from '../../src/mining/messages'
import { miningTab, type MiningTab } from '../../src/mining/navigation'
import { onlineMessages } from '../../src/mining/onlineMessages'
import { miningNetworkMessages } from '../../src/i18n/mining-network'
import { NETWORK } from '../../src/network'
import { usePreferences } from '../../src/preferences/context'
import { PreferencesProvider } from '../../src/preferences/PreferencesProvider'
import { miningTestDeployment, miningTestRpc, MINING_TEST_ACCOUNT } from '../fixtures/miningProducts'

if (!import.meta.env.DEV || location.hostname !== '127.0.0.1' || NETWORK.chainId !== 1952) throw new Error('Loopback 1952 UI fixture only')
const d = miningTestDeployment(), scenario = new URLSearchParams(location.search).get('state') ?? 'connected'
const read = miningTestRpc(d, (name, to) => name === 'quoteExactIn' ? 10n ** 18n : name === 'paused' ? scenario === 'paused'
  : name === 'balanceOf' ? to === d.contracts.fab.address ? 124_850_000_000n : 25n * 10n ** 18n : undefined)
const submitted = new Map<string, { from: string; to: string }>()
globalThis.fetch = async (input, options) => {
  const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
  if (path === '/api/rpc') {
    const body = JSON.parse(String(options?.body)) as { method: Parameters<typeof read>[0]; params: unknown[]; id: string }
    if (scenario === 'read-failed') return Response.json({ error: { code: -32000, message: 'Fixture read failure' } })
    const result = body.method === 'eth_getTransactionReceipt' ? { ...submitted.get(String(body.params[0])), transactionHash: body.params[0], status: '0x1', blockHash: `0x${'b'.repeat(64)}` }
      : await read(body.method, body.params)
    return Response.json({ jsonrpc: '2.0', id: body.id, result })
  }
  const envelope = { schemaVersion: 1, chainId: 1952, deploymentVersion: d.version }
  if (path.startsWith('/api/index/events')) {
    if (scenario === 'read-failed') return Response.json({ error: 'Fixture index failure' }, { status: 503 })
    const query = new URL(path, location.origin).searchParams, offset = Number(query.get('cursor') ?? 0)
    const head = { number: 1000, hash: `0x${'a'.repeat(64)}`, timestamp: 1_760_000_000 }
    const count = query.has('owner') ? 4 : 23
    return Response.json({ ...envelope, asOf: head, nextCursor: offset + 10 < count ? String(offset + 10) : null,
      index: { ...envelope, head, indexedThrough: 950, fromBlock: 1, syncing: true, lastError: null, generation: 0 },
      events: Array.from({ length: Math.max(0, Math.min(10, count - offset)) }, (_, i) => ({
        id: `event-${offset + i}`, address: d.contracts.fragmentPool.address, event: ['Swapped', 'Deposited', 'RewardsPaid'][(offset + i) % 3],
        blockNumber: 900 - offset - i, blockHash: head.hash, transactionHash: `0x${(offset + i + 1).toString(16).padStart(64, '0')}`,
        logIndex: offset + i, args: { amount: '100000000' }, transactionFrom: MINING_TEST_ACCOUNT, timestamp: head.timestamp - (offset + i) * 30,
      })) })
  }
  if (path.startsWith('/api/mining/projects')) return Response.json({ ...envelope, revision: 'visual', projects: d.projects })
  if (path === '/api/mining/status') return Response.json({ ...envelope, admissionEnabled: false, executionEnabled: false, signer: MINING_TEST_ACCOUNT, keeper: null,
    budget: { capWei: '0', spentWei: '0', reservedWei: '0' }, farm: null, jobs: [] })
  throw new Error('External requests and service writes are blocked in this UI fixture')
}
const provider = { request: async ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
  if (method === 'eth_accounts') return [MINING_TEST_ACCOUNT]
  if (method === 'eth_chainId') return '0x7a0'
  if (method === 'eth_sendTransaction') {
    if (scenario === 'wallet-reject') throw { code: 4001 }
    const hash = `0x${(submitted.size + 1).toString(16).padStart(64, '0')}` as Hex
    submitted.set(hash, params![0] as { from: string; to: string }); return hash
  }
  throw new Error('No signatures or real wallet methods in the visual fixture')
} }
function Fixture(): ReactElement {
  const { locale } = usePreferences(), m = miningMessages(locale), n = miningNetworkMessages(locale), online = onlineMessages(locale)
  const [tab, setTab] = useState<MiningTab>(() => miningTab(location.hash)), [connected, setConnected] = useState(scenario !== 'disconnected')
  const [busy, setBusy] = useState(false), [preferences, setPreferences] = useState(false)
  const identity = { address: MINING_TEST_ACCOUNT, chainId: 1952, provider, revision: 1 }
  const wallet: WalletController = { options: [], session: connected ? { ...identity, id: 'visual', name: 'Visual fixture' } : undefined,
    status: 'idle', error: undefined, connect: async () => setConnected(true), switchChain: async () => {}, disconnect: () => setConnected(false), getIdentity: () => connected ? identity : undefined }
  const navigate = (next: MiningTab): void => { if (!busy) { setTab(next); history.replaceState(null, '', `#${next}`) } }
  return <div className="app-shell">
    <Header page="swap" miningPage={tab} navigationDisabled={busy} onMiningPageChange={navigate} onPageChange={() => {}}
      wallet={wallet} onWallet={() => setConnected(!connected)} onPreferences={() => setPreferences(true)} />
    <div className="test-notice"><span className="test-notice-label">UI FIXTURE</span><p>本地模拟界面 · 所有数据与交易均为模拟 · 无外部钱包或链上请求</p></div>
    <main className="content-page mining-network-page">
      <div className="page-heading mining-heading"><div><p className="eyebrow">FAB · X Layer Testnet · 1952</p>
        <h1>{tab === 'launch' || tab === 'automation' ? online[tab] : m[tab]}</h1><p>{tab === 'fragments' ? n.fragmentsIntro : n.fundraisingIntro}</p></div>
        <span className="mining-chain-chip"><Icon name="layers" size={15} />1952 · TESTNET</span></div>
      <MiningProductsWorkspace deployment={d} wallet={wallet} activeTab={tab} onTabChange={navigate} onBusyChange={setBusy}
        onConnect={connected ? undefined : () => setConnected(true)} />
    </main>
    {preferences && <PreferencesDialog onClose={() => setPreferences(false)} />}
  </div>
}
const container = document.getElementById('root')
if (!container) throw new Error('Fixture root missing')
createRoot(container).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PreferencesProvider><Fixture /></PreferencesProvider></QueryClientProvider>)
