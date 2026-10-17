// Development-only entry: real local service, real local contracts, publicly derived test wallet.
import '../../src/styles.css'
import '../../src/mining-network.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRef, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { keccak256, stringToHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { parseMiningDeployment } from '../../../mining-products'
import { Button, SodaMark } from '../../src/components/primitives'
import { PreferencesDialog } from '../../src/components/PreferencesDialog'
import { WalletDialog } from '../../src/components/WalletDialog'
import type { WalletController } from '../../src/lib/useWallet'
import type { Eip1193Provider, WalletIdentity, WalletSession } from '../../src/lib/wallet'
import { MiningProductsWorkspace } from '../../src/mining/ProductsWorkspace'
import { NETWORK } from '../../src/network'
import { PreferencesProvider } from '../../src/preferences/PreferencesProvider'

if (!import.meta.env.DEV || location.hostname !== '127.0.0.1' || NETWORK.chainId !== 1952) throw new Error('Isolated loopback 1952 development entry only')
const rpcUrl = 'http://127.0.0.1:8954', serviceUrl = 'http://127.0.0.1:8791/v1/'
const fetchOriginal = globalThis.fetch.bind(globalThis)
const saved: unknown = await (await fetchOriginal(new URL('../../../../.analysis/mining-1952/browser-online-fixture/products.json', import.meta.url))).json()
const fixture: unknown = await (await fetchOriginal(new URL('../../../../.analysis/mining-1952/browser-online-fixture/addresses.json', import.meta.url))).json()
if (!fixture || typeof fixture !== 'object' || !('online' in fixture) || fixture.online !== true ||
    !('account' in fixture) || typeof fixture.account !== 'string' || !('minerId' in fixture) || !Number.isSafeInteger(fixture.minerId) ||
    !('farmListingId' in fixture) || !Number.isSafeInteger(fixture.farmListingId) || !('testListingId' in fixture) ||
    fixture.testListingId === fixture.farmListingId) throw new Error('Separate online fixture required')
const account = privateKeyToAccount(keccak256(stringToHex('alice')))
if (account.address.toLowerCase() !== fixture.account.toLowerCase()) throw new Error('Only the publicly derived dummy Alice wallet is supported')
const minerId = Number(fixture.minerId), farmListingId = Number(fixture.farmListingId)
const deployment = parseMiningDeployment(saved)
if (deployment.state !== 'ready' || !deployment.version.startsWith('loopback-online-v2-')) throw new Error('Online real-contract manifest required')
const readyDeployment = deployment
async function localRpc(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetchOriginal(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const value: unknown = await response.json()
  if (!value || typeof value !== 'object') throw new Error('Invalid loopback RPC response')
  if ('error' in value) throw new Error('Loopback contract call failed')
  if (!('result' in value)) throw new Error('Missing loopback RPC result')
  return value.result
}
if (await localRpc('eth_chainId') !== '0x7a0' || !String(await localRpc('web3_clientVersion')).toLowerCase().startsWith('anvil')) throw new Error('The isolated 8954 Anvil must be running')
globalThis.fetch = (input, options) => {
  if (input === '/api/rpc') return fetchOriginal(rpcUrl, { ...options, headers: { 'Content-Type': 'application/json' } })
  if (typeof input === 'string' && input.startsWith('/api/mining/')) {
    const suffix = input.slice('/api/mining/'.length), endpoint = suffix.split('?')[0]
    if (!['status', 'projects', 'challenge', 'launch', 'register', 'run'].includes(endpoint)) throw new Error('Unsupported local service endpoint')
    // Browsers supply the actual page Origin. No private Worker bridge token is injected.
    return fetchOriginal(new URL(suffix, serviceUrl), { ...options, credentials: 'omit' })
  }
  return fetchOriginal(input, options)
}
const provider: Eip1193Provider = { request: async ({ method, params = [] }) => {
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account.address]
  if (method === 'personal_sign') {
    if (params.length !== 2 || typeof params[0] !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(params[0]) ||
        typeof params[1] !== 'string' || params[1].toLowerCase() !== account.address.toLowerCase()) throw new Error('Invalid dummy-wallet authentication')
    return account.signMessage({ message: { raw: params[0] as Hex } })
  }
  if (!['eth_chainId', 'eth_sendTransaction'].includes(method)) throw new Error('Unsupported dummy-wallet method')
  if (method === 'eth_sendTransaction' && (params.length !== 1 || !params[0] || typeof params[0] !== 'object' ||
      !('from' in params[0]) || typeof params[0].from !== 'string' || params[0].from.toLowerCase() !== account.address.toLowerCase())) throw new Error('Only dummy Alice may submit on isolated 8954')
  return localRpc(method, params)
} }
/** This harness never discovers extensions or exposes the user's real wallets. */
function useFixtureWallet(): WalletController {
  const [session, setSession] = useState<WalletSession>(), [status, setStatus] = useState<WalletController['status']>('idle')
  const [error, setError] = useState<WalletController['error']>(), identity = useRef<WalletIdentity | undefined>(undefined), revision = useRef(0)
  const option = { id: 'online-fixture-alice', name: 'Alice · 仅本地 8954', provider }
  const connect: WalletController['connect'] = async (selected) => {
    setStatus('connecting'); setError(undefined)
    try {
      if (selected.provider !== provider || await localRpc('eth_chainId') !== '0x7a0') throw new Error('Invalid local fixture wallet')
      const next = { ...option, address: account.address, chainId: 1952 }
      identity.current = { ...next, revision: ++revision.current }; setSession(next)
    } catch { setError('walletFailed') }
    finally { setStatus('idle') }
  }
  return { options: [option], session, status, error, connect, switchChain: () => connect(option),
    disconnect: () => { revision.current++; identity.current = undefined; setSession(undefined) }, getIdentity: () => identity.current }
}
function OnlineFixture(): ReactElement {
  const wallet = useFixtureWallet(), [walletOpen, setWalletOpen] = useState(false), [preferencesOpen, setPreferencesOpen] = useState(false)
  return <div className="app-shell">
    <header className="site-header mining-network-header"><div className="brand"><SodaMark decorative /><span>SodaDEX</span><span className="test-tag">LOCAL ONLINE TEST</span></div>
      <div className="header-actions"><Button onClick={() => setWalletOpen(true)}>{wallet.session ? '已连接本地 Alice' : '连接本地 Alice'}</Button>
        <Button onClick={() => setPreferencesOpen(true)}>偏好设置</Button></div></header>
    <main className="content-page mining-network-page"><p className="eyebrow">独立本地在线签名验收 · 未连接公共测试网</p>
      <h1>FAB 发行与自动处理</h1><p className="dialog-note">钱包及业务合约仅使用 127.0.0.1:8954；签名服务仅使用 127.0.0.1:8791。所有余额、报价、回执和任务结果来自实际本地执行。</p>
      <p className="dialog-note">Alice 使用公开可推导的测试密钥；禁止转入真实资产。可存取矿机 NFT #{minerId}；后台专用采购挂单 #{farmListingId}。本地仅模拟 OP 零附加费基础设施，不替换业务合约。</p>
      <MiningProductsWorkspace deployment={readyDeployment} wallet={wallet} /></main>
    {walletOpen && <WalletDialog wallet={wallet} onClose={() => setWalletOpen(false)} />}
    {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}
  </div>
}
const container = document.getElementById('root')
if (!container) throw new Error('Online fixture root missing')
createRoot(container).render(<QueryClientProvider client={new QueryClient()}><PreferencesProvider><OnlineFixture /></PreferencesProvider></QueryClientProvider>)
