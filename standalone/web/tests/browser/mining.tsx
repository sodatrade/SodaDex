// Dev-only loopback test entry. Vite's production entry never imports this file.
import '../../src/styles.css'
import '../../src/mining-network.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { parseMiningDeployment } from '../../../mining-products'
import { Button, SodaMark } from '../../src/components/primitives'
import { WalletDialog } from '../../src/components/WalletDialog'
import { PreferencesDialog } from '../../src/components/PreferencesDialog'
import { useWallet } from '../../src/lib/useWallet'
import { MiningProductsWorkspace } from '../../src/mining/ProductsWorkspace'
import { NETWORK } from '../../src/network'
import { PreferencesProvider } from '../../src/preferences/PreferencesProvider'

if (!import.meta.env.DEV || location.hostname !== '127.0.0.1' || NETWORK.chainId !== 1952) throw new Error('Loopback 1952 development entry only')
const saved: unknown = await (await fetch(new URL('../../../../.analysis/mining-1952/browser-fixture/products.json', import.meta.url))).json()
const fixture: unknown = await (await fetch(new URL('../../../../.analysis/mining-1952/browser-fixture/addresses.json', import.meta.url))).json()
if (!fixture || typeof fixture !== 'object' || !('account' in fixture) || typeof fixture.account !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(fixture.account) || !('minerId' in fixture) || !Number.isSafeInteger(fixture.minerId)) throw new Error('Invalid local fixture')
const localAccount = fixture.account, minerId = Number(fixture.minerId)
const deployment = parseMiningDeployment(saved)
if (deployment.state !== 'ready') throw new Error('Real-contract fixture required')
const readyDeployment = deployment
const fetchOriginal = globalThis.fetch.bind(globalThis)
globalThis.fetch = (input, options) => input === '/api/rpc' ? fetchOriginal('http://127.0.0.1:8952', {
  ...options, headers: { 'Content-Type': 'application/json' },
}) : fetchOriginal(input, options)
;(window as Window & { ethereum?: unknown }).ethereum = { request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [localAccount]
  if (!['eth_chainId', 'eth_sendTransaction'].includes(method)) throw new Error('Unsupported loopback wallet request')
  const response = await fetchOriginal('http://127.0.0.1:8952', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const result = await response.json()
  if (result.error) throw new Error(result.error.message)
  return result.result
} }
function Fixture(): ReactElement {
  const wallet = useWallet(), [walletOpen, setWalletOpen] = useState(false), [preferencesOpen, setPreferencesOpen] = useState(false)
  return <div className="app-shell">
    <header className="site-header mining-network-header"><div className="brand"><SodaMark decorative /><span>SodaDEX</span><span className="test-tag">LOCAL TEST</span></div>
      <div className="header-actions"><Button onClick={() => setWalletOpen(true)}>{wallet.session ? '已连接本地测试钱包' : '连接本地测试钱包'}</Button>
        <Button onClick={() => setPreferencesOpen(true)}>偏好设置</Button></div></header>
    <main className="content-page mining-network-page"><p className="eyebrow">本地真实合约模拟 · 未连接公共测试网</p>
      <h1>FAB 矿机测试</h1><p className="dialog-note">使用真实合约构造与状态导出，仅在 127.0.0.1 执行，无真实资产。可存入的测试矿机 NFT：{minerId}。</p>
      <MiningProductsWorkspace deployment={readyDeployment} wallet={wallet} /></main>
    {walletOpen && <WalletDialog wallet={wallet} onClose={() => setWalletOpen(false)} />}
    {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}
  </div>
}
const container = document.getElementById('root')
if (!container) throw new Error('Fixture root missing')
createRoot(container).render(<QueryClientProvider client={new QueryClient()}><PreferencesProvider><Fixture /></PreferencesProvider></QueryClientProvider>)
