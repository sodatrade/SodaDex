// Local visual evidence only. Requests never leave this fixture; no wallet is loaded.
import '../../src/styles.css'
import '../../src/workspace.css'
import '../../src/features/liquidity/liquidity.css'
import '../../src/features/portfolio/portfolio.css'
import '../../src/features/swap/swap.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { PoolList } from '../../src/features/liquidity/PoolList'
import { MarketPage } from '../../src/features/market/MarketPage'
import { BalanceTable } from '../../src/features/portfolio/BalanceTable'
import { CurrencyPicker } from '../../src/features/swap/CurrencyPicker'
import { liquidityText } from '../../src/i18n/liquidity'
import { KNOWN_CURRENCIES, NATIVE_CURRENCY } from '../../src/liquidity'
import type { LiquidityPool } from '../../src/liquidity/types'
import { usePreferences } from '../../src/preferences/context'
import { PreferencesProvider } from '../../src/preferences/PreferencesProvider'

if (!import.meta.env.DEV || location.hostname !== '127.0.0.1') throw new Error('Loopback UI fixture only')
const mode = new URLSearchParams(location.search).get('mode') ?? 'pools'
globalThis.fetch = async (input) => {
  if (String(input) === '/api/reference/tokens') return Response.json({ chainId: 196, tokens: [] })
  if (mode === 'loading') return new Promise(() => {})
  if (mode === 'error') return Response.json({ error: 'Fixture failure' }, { status: 503 })
  if (mode === 'empty') return Response.json({ schemaVersion: 1, chainId: 196, asOf: { number: 1, hash: `0x${'a'.repeat(64)}`, timestamp: 1 },
    coverage: { fromBlock: 1, toBlock: 1, complete: true, nextFromBlock: null }, pools: [], nextCursor: null })
  throw new Error('No external requests in controls fixture')
}
const pools: LiquidityPool[] = Array.from({ length: 23 }, (_, index) => ({ protocol: 'v4', id: `0x${index.toString(16).padStart(64, '0')}`,
  currency0: { ...NATIVE_CURRENCY, symbol: `TEST-${index + 1}` }, currency1: KNOWN_CURRENCIES.find((c) => c.symbol === 'USD₮0')!,
  fee: 0, tickSpacing: 1, sqrtPriceX96: 1n << 96n, tick: 0, liquidity: 1n, initialized: true }))
function Fixture(): ReactElement {
  const { locale } = usePreferences(), [action, setAction] = useState(''), [picker, setPicker] = useState(mode === 'tokens')
  const tokens = pools.map((pool, index) => ({ currency: { ...pool.currency0, native: false, address: `0x${(index + 1).toString(16).padStart(40, '0')}` as const, name: `Test token ${index + 1}` }, balance: BigInt(index + 1) * 10n ** 18n }))
  return <div className="app-shell"><div className="test-notice">本地 UI 模拟 · 23 条虚构记录 · 不连接钱包或外部服务</div>
    {mode === 'pools' ? <main className="content-page lp-page"><h1>池子操作与分页</h1>
      <PoolList pools={pools} l={liquidityText(locale)} disabled={false} onDetails={(pool) => setAction(`查看 ${pool.currency0.symbol}`)} />
      {action && <p role="status">{action} · 仅模拟交互</p>}</main> : mode === 'portfolio' || mode === 'tokens' ? <main className="content-page portfolio-page"><h1>资产列表与选币分页</h1>
      <BalanceTable tokens={tokens} onSend={(token) => setAction(`选择 ${token.currency.symbol}`)} />
      {picker && <CurrencyPicker currencies={tokens.map((token) => token.currency)} selected={tokens[0].currency}
        onClose={() => setPicker(false)} onSelect={(currency) => { setAction(`选择 ${currency.symbol}`); setPicker(false) }} />}
      {action && <p role="status">{action} · 仅模拟交互</p>}</main> : <MarketPage />}</div>
}
const container = document.getElementById('root')
if (!container) throw new Error('Fixture root missing')
createRoot(container).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PreferencesProvider><Fixture /></PreferencesProvider></QueryClientProvider>)
