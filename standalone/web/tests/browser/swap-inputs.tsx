import '../../src/styles.css'
import '../../src/fragments/fragments.css'
import '../../src/features/swap/swap.css'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { parseEther } from 'viem'
import { PreferencesProvider } from '../../src/preferences/PreferencesProvider'
import { SwapScreen } from '../../src/fragments/SwapScreen'
import { messages } from '../../src/fragments/messages'
import type { ScreenProps } from '../../src/fragments/types'
import { NATIVE_CURRENCY } from '../../src/liquidity/config'
import type { Currency } from '../../src/liquidity/types'
import { CurrencyPicker } from '../../src/features/swap/CurrencyPicker'
import { AmountPanel } from '../../src/features/swap/AmountPanel'
const address = '0x1111111111111111111111111111111111111111'
const share: Currency = { address, symbol: 'sFAB', name: 'Soda miner shares', decimals: 18, native: false }
const currencies = [NATIVE_CURRENCY, share, ...Array.from({ length: 8 }, (_, i): Currency => ({ address: `0x${String(i + 2).padStart(40, '0')}`, symbol: `TEST${i}`, name: `Fixture token ${i}`, decimals: 18, native: false }))]
const client = { readContract: async () => [parseEther('3'), 0n, 0n] } as unknown as ScreenProps['client']
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function Fixture() {
  const [ordinary, setOrdinary] = useState(false), [reverse, setReverse] = useState(false), [picker, setPicker] = useState(false)
  const [amount, setAmount] = useState('')
  const [account, setAccount] = useState<ScreenProps['account']>(address)
  const from = reverse ? share : NATIVE_CURRENCY, to = reverse ? NATIVE_CURRENCY : share
  return <PreferencesProvider><div className="fragment-shell" style={{ minHeight: '100vh', padding: 20 }}>
    <nav style={{ display: 'flex', gap: 12, marginBottom: 20 }}><button onClick={() => setOrdinary(false)}>专用池</button><button onClick={() => setOrdinary(true)}>普通池</button><button onClick={() => setAccount(account ? undefined : address)}>连接状态</button></nav>
    <main style={{ maxWidth: 440, margin: 'auto' }}>{ordinary ? <section className="swap-card general-swap"><h2>兑换</h2>
      <AmountPanel currency={from} pay amount={amount} onAmount={setAmount} balance="余额 2" disabled={false} onSelect={() => setPicker(true)} />
      <div className="direction-row"><button className="direction-button" onClick={() => setReverse(!reverse)}>↓</button></div>
      <AmountPanel currency={to} amount="3" balance="余额 1250.123456" disabled={false} onSelect={() => setPicker(true)} /></section>
      : <SwapScreen client={client} deployment={{ chainId: 196, vault: address, pool: address, policy: address, fromBlock: 0n, rpcUrl: 'http://fixture.invalid' }}
        snapshot={{ okb: parseEther('10'), shares: parseEther('100'), lpSupply: 1n, rewards: address, preciseLiquidity: true, mirrorVault: false, tradingPaused: false, vaultClaimable: undefined, okbBalance: parseEther('2'), shareBalance: parseEther('1250.123456789'), lpBalance: 0n }}
        account={account} m={messages('zh-CN')} prepare={() => { throw new Error('This read-only fixture never prepares transactions') }} onConnect={() => setAccount(address)}
        selection={{ from, to, onSelect: () => setPicker(true), onReverse: () => setReverse(!reverse) }} />}</main>
    {picker && <CurrencyPicker poolOnly currencies={currencies} selected={from} onSelect={() => setPicker(false)} onClose={() => setPicker(false)} />}
  </div></PreferencesProvider>
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><Fixture /></QueryClientProvider>)
