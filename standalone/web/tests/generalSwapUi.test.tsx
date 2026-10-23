// Retained protocol integration coverage with all protocols enabled.
vi.mock('../src/domain/visibleProtocols', () => ({
  VISIBLE_POOL_PROTOCOLS: ['v2', 'v3', 'v4'], VISIBLE_POSITION_PROTOCOLS: ['v3', 'v4'],
  isVisibleProtocol: () => true,
}))
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { zeroAddress, type Hex } from 'viem'
import { confirmedPoolsKey } from '../src/features/liquidity/confirmedPools'
import { GeneralSwapCard } from '../src/features/swap/GeneralSwapCard'
import { OrdinarySwap } from '../src/fragments/OrdinarySwap'
import type { FragmentDeployment } from '../src/fragments/config'
import type { PairSelection } from '../src/features/swap/pairExtension'
import { KNOWN_CURRENCIES } from '../src/liquidity/config'
import * as liquidity from '../src/liquidity'
import type { Currency, LiquidityPool } from '../src/liquidity/types'
import type { WalletController } from '../src/lib/useWallet'
import type { WalletIdentity } from '../src/lib/wallet'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { PREFERENCES_KEY } from '../src/preferences/model'
import * as trades from '../src/trading/poolTrade'
import * as wrapping from '../src/trading/wrapping'
import * as policy from '../../trading-policy'
import * as receipts from '../src/trading/receipts'
import { readTransactions, recordTransaction } from '../src/features/history/journal'
import { CONTRACTS } from '../src/trading/config'
const [native, , stable] = KNOWN_CURRENCIES
const owner = '0x1111111111111111111111111111111111111111', hash = `0x${'a'.repeat(64)}` as Hex
const custom: Currency = { address: '0x3333333333333333333333333333333333333333', decimals: 8, symbol: 'NEW', name: 'New Token', native: false }
const pool: LiquidityPool = { protocol: 'v4', id: `0x${'b'.repeat(64)}`, currency0: { ...native, address: zeroAddress }, currency1: stable,
  fee: 0, tickSpacing: 1, sqrtPriceX96: 2n ** 96n, tick: 0, liquidity: 1000n, initialized: true }
let identity: WalletIdentity | undefined
let wallet: WalletController
const balances = { okb: 10n ** 18n, wokb: 10n ** 18n, usdt0: 1000000n }
function mount(): { rerender: () => void; client: QueryClient } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const tree = () => <QueryClientProvider client={client}><PreferencesProvider><GeneralSwapCard wallet={wallet} balances={balances} balancesLoading={false} balancesError={false} onConnect={vi.fn()} /></PreferencesProvider></QueryClientProvider>
  const view = render(tree()); return { rerender: () => view.rerender(tree()), client }
}
beforeEach(() => {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale: 'en', theme: 'light', currency: 'USD' }))
  const provider = { request: vi.fn(async () => '0xc4') }
  identity = { address: owner, chainId: 196, provider, revision: 1 }
  wallet = { options: [], session: { ...identity, id: 'mock', name: 'Mock' }, status: 'idle', error: undefined, getIdentity: () => identity,
    connect: vi.fn(), switchChain: vi.fn(), disconnect: vi.fn() }
  vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(true)
  vi.spyOn(liquidity, 'listAllPools').mockResolvedValue([pool])
  vi.spyOn(liquidity, 'importCurrency').mockResolvedValue(custom)
  vi.spyOn(trades, 'getPoolTradeQuote').mockImplementation(async (p, dir, amount, slippageBps = 50) => ({ pool: p, zeroForOne: dir, amount, amountOut: 1000n, minimumOut: 995n, slippageBps }))
  vi.spyOn(trades, 'executePoolTrade').mockImplementation(async (_quote, c) => { c.onProgress({ stage: 'tradeConfirming', hash, to: CONTRACTS.router, kind: 'swap' }); c.onProgress({ stage: 'tradeSucceeded', hash, kind: 'swap' }); return hash })
  vi.spyOn(wrapping, 'executeWrap').mockResolvedValue(hash)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function amount(value = '0.000001'): Promise<void> {
  await userEvent.type(screen.getByLabelText('You pay'), value)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review swap' })).toBeEnabled())
}
describe('main swap interactions', () => {
  it('defaults the configured deployment to OKB/FABS before snapshot loading and preserves a manual selection on refresh', async () => {
    wallet = { ...wallet, session: undefined, getIdentity: () => undefined }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const deployment: FragmentDeployment = { chainId: 196, vault: owner, pool: owner, policy: owner, fabs: custom.address, fromBlock: 0n, rpcUrl: 'http://fixture.invalid' }
    const tree = () => <QueryClientProvider client={client}><PreferencesProvider><OrdinarySwap wallet={wallet} active
      onConnect={vi.fn()} onCreatePool={vi.fn()} onBusyChange={vi.fn()}
      fragment={{ deployment: { ...deployment }, fallback: <p>Loading share pool</p> }} /></PreferencesProvider></QueryClientProvider>
    const view = render(tree())
    expect(screen.getByRole('button', { name: 'OKB ▾' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'FABS ▾' })).toBeVisible()
    expect(screen.getByText('Loading share pool')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'FABS ▾' }))
    await userEvent.click(await screen.findByRole('button', { name: /USD₮0/ }))
    view.rerender(tree())
    expect(screen.getByRole('button', { name: /Choose receive.*USD₮0/ })).toBeVisible()
    expect(screen.queryByText('Loading share pool')).not.toBeInTheDocument()
    expect(trades.executePoolTrade).not.toHaveBeenCalled()
  })

  it('reverses the default extension pair and keeps that direction across refreshes', async () => {
    const share = { ...custom, symbol: 'FABS', decimals: 18 }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const renderPair = ({ from, to, onReverse }: PairSelection) => <button onClick={onReverse}>{from.symbol} → {to.symbol}</button>
    const tree = () => <QueryClientProvider client={client}><PreferencesProvider><GeneralSwapCard wallet={wallet} balances={balances}
      balancesLoading={false} balancesError={false} onConnect={vi.fn()} pairExtension={{ currencies: [native, share],
        initialPair: { from: native, to: share }, matches: (a, b) => (a.native && b.address === share.address) || (b.native && a.address === share.address), render: renderPair }} /></PreferencesProvider></QueryClientProvider>
    const view = render(tree())
    await userEvent.click(screen.getByRole('button', { name: 'OKB → FABS' }))
    view.rerender(tree())
    expect(screen.getByRole('button', { name: 'FABS → OKB' })).toBeVisible()
    expect(trades.executePoolTrade).not.toHaveBeenCalled()
  })

  it('quotes a V2-only directory on a fresh Swap page without a Pool-page cache', async () => {
    const v2 = { protocol: 'v2' as const, id: custom.address, address: custom.address,
      currency0: stable, currency1: { ...native, address: KNOWN_CURRENCIES[1].address }, fee: 3000 as const,
      reserve0: 1000000n, reserve1: 10n ** 18n, totalSupply: 10n ** 12n, kLast: 0n, feeOn: false, initialized: true }
    vi.mocked(liquidity.listAllPools).mockResolvedValue([v2])
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Swap settings' }))
    await userEvent.click(screen.getByRole('radio', { name: 'V2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    await amount()
    expect(trades.getPoolTradeQuote).toHaveBeenCalledWith(v2, false, 1000000000000n, 50)
    expect(trades.executePoolTrade).not.toHaveBeenCalled()
  })
  it('keeps directory failure and retry visible when the cached pool belongs to another pair', async () => {
    vi.mocked(liquidity.listAllPools).mockRejectedValue(new Error('Directory unavailable'))
    const { client } = mount()
    await act(async () => { client.setQueryData(confirmedPoolsKey, [{ ...pool, currency1: custom }]) })
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(screen.getByRole('alert')).toBeVisible()
    expect(trades.executePoolTrade).not.toHaveBeenCalled()
  })

  it('quotes a confirmed live pool while the persistent directory is still loading', async () => {
    vi.mocked(liquidity.listAllPools).mockImplementation(() => new Promise(() => {}))
    const { client } = mount()
    await act(async () => { client.setQueryData(confirmedPoolsKey, [pool]) })
    await amount()
    expect(trades.getPoolTradeQuote).toHaveBeenCalledWith(pool, true, 1000000000000n, 50)
    expect(screen.getByRole('button', { name: 'Review swap' })).toBeEnabled()
    expect(trades.executePoolTrade).not.toHaveBeenCalled()
  })

  it('finds the configured share token in the normal picker and routes only its native pair to the extension', async () => {
    const share = { ...custom, symbol: 'sFAB', name: 'Miner shares', decimals: 18 }
    const renderPair = vi.fn(({ onSelect }: { onSelect: (side: 'to') => void }) => <button onClick={() => onSelect('to')}>Change share token</button>)
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><PreferencesProvider><GeneralSwapCard wallet={wallet} balances={balances} balancesLoading={false} balancesError={false} onConnect={vi.fn()} pairExtension={{currencies:[share],matches:(a,b)=>a.native && b.address===share.address,render:renderPair}} /></PreferencesProvider></QueryClientProvider>)
    await userEvent.click(screen.getByRole('button',{name:/Choose receive/}))
    await userEvent.type(screen.getByRole('textbox',{name:'Search name, symbol or contract'}),'sFAB')
    await userEvent.click(screen.getByRole('button',{name:/sFAB/}))
    expect(await screen.findByRole('button',{name:'Change share token'})).toBeVisible()
    expect(trades.getPoolTradeQuote).not.toHaveBeenCalled()
    expect(trades.executePoolTrade).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button',{name:'Change share token'}))
    await userEvent.click(screen.getByRole('button',{name:/USD₮0/}))
    expect(await screen.findByLabelText('You pay')).toBeVisible()
    expect(screen.queryByRole('button',{name:'Change share token'})).not.toBeInTheDocument()
  })
  it('shows pool fee/minimum and executes only after explicit confirmation', async () => {
    mount(); await amount(); expect(trades.executePoolTrade).not.toHaveBeenCalled()
    expect(screen.getByText('Minimum received')).toBeVisible()
    expect(screen.getByText('0.000995 USD₮0')).toBeVisible()
    expect(screen.getByText('Price impact')).toBeVisible()
    expect(screen.getByText('Slippage tolerance')).toBeVisible()
    expect(screen.getByText('Pool fee')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Review swap' }))
    const dialog = screen.getByRole('dialog'); expect(within(dialog).getByText('0.000995 USD₮0')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm swap' }))
    await waitFor(() => expect(trades.executePoolTrade).toHaveBeenCalledTimes(1))
    expect(readTransactions(owner)[0]).toMatchObject({ hash, status: 'success', kind: 'swap' })
  })
  it('hides stale output and blocks review after a background quote failure, then recovers', async () => {
    const view = mount(); await amount()
    expect(screen.getByLabelText('You receive')).toHaveValue('0.001')
    vi.mocked(trades.getPoolTradeQuote).mockRejectedValue(new Error('RPC unavailable'))
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['swap', 'quote'] }) })
    await screen.findByText('No route could quote this amount.')
    expect(screen.getByLabelText('You receive')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Review swap' })).toBeDisabled()
    expect(screen.queryByText('Trade details')).not.toBeInTheDocument()
    expect(trades.executePoolTrade).not.toHaveBeenCalled()
    let finishQuote: (() => void) | undefined
    vi.mocked(trades.getPoolTradeQuote).mockImplementation((p, dir, value, slippageBps = 50) => new Promise(resolve => {
      finishQuote = () => resolve({ pool: p, zeroForOne: dir, amount: value, amountOut: 1000n, minimumOut: 995n, slippageBps })
    }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByText('No route could quote this amount.')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Getting quote…' })).toBeDisabled()
    expect(screen.getByLabelText('You receive')).toHaveValue('')
    expect(trades.executePoolTrade).not.toHaveBeenCalled()
    await act(async () => { finishQuote?.() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review swap' })).toBeEnabled())
    expect(screen.getByLabelText('You receive')).toHaveValue('0.001')
  })
  it('selects a token from a newly created pool and quotes its actual fee', async () => {
    vi.mocked(liquidity.listAllPools).mockResolvedValue([pool, { ...pool, currency1: custom, fee: 500 }])
    mount(); await userEvent.click(screen.getByRole('button', { name: /Choose receive/ }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search name, symbol or contract' }), custom.address)
    await userEvent.click(await screen.findByRole('button', { name: /NEW/ })); await amount()
    expect(trades.getPoolTradeQuote).toHaveBeenCalledWith(expect.objectContaining({ fee: 500, currency1: custom }), true, 1000000000000n, 50)
  })
  it('does not import an unrelated contract into Swap without a SodaDEX pool', async () => {
    mount(); await userEvent.click(screen.getByRole('button', { name: /Choose receive/ }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search name, symbol or contract' }), custom.address)
    expect(screen.getByRole('status')).toHaveTextContent('No matching token with SodaDEX liquidity.')
    expect(screen.queryByRole('button', { name: 'Import token' })).not.toBeInTheDocument()
    expect(liquidity.importCurrency).not.toHaveBeenCalled()
  })
  it('ignores the global reference token list in Swap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ chainId: 196, tokens: [{ ...custom, symbol: 'LISTED' }] }), { status: 200 })))
    mount(); await userEvent.click(screen.getByRole('button', { name: /Choose receive/ }))
    expect(screen.queryByRole('button', { name: /LISTED/ })).not.toBeInTheDocument()
    expect(liquidity.importCurrency).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalledWith('/api/reference/tokens', expect.anything())
  })
  it('does not expose saved imports or zero-liquidity pool assets', async () => {
    localStorage.setItem('sodadex.imported-tokens.196.v1', JSON.stringify([custom.address]))
    vi.mocked(liquidity.listAllPools).mockResolvedValue([pool, { ...pool, id: `0x${'c'.repeat(64)}`, currency1: custom, liquidity: 0n }])
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    mount(); await userEvent.click(screen.getByRole('button', { name: /Choose receive/ }))
    expect(await screen.findByRole('button', { name: /WOKB/ })).toBeEnabled()
    await userEvent.type(screen.getByRole('textbox', { name: 'Search name, symbol or contract' }), custom.address)
    expect(screen.queryByRole('button', { name: 'Import token' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /NEW/ })).not.toBeInTheDocument()
    expect(liquidity.importCurrency).not.toHaveBeenCalled()
  })
  it('supports wrap as an explicit 1:1 wallet operation', async () => {
    mount(); await userEvent.click(screen.getByRole('button', { name: /Choose receive/ })); await userEvent.click(screen.getByRole('button', { name: /WOKB/ }))
    await userEvent.type(screen.getByLabelText('You pay'), '0.000001')
    expect(screen.getByLabelText('You receive')).toHaveValue('0.000001')
    await userEvent.click(screen.getByRole('button', { name: 'Wrap' })); await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm swap' }))
    expect(wrapping.executeWrap).toHaveBeenCalledWith({ direction: 'wrap', amount: 1000000000000n }, expect.anything())
  })
  it('switches wrong network and rejects more than the actual balance', async () => {
    identity = { ...identity!, chainId: 1 }; wallet.session = { ...identity, id: 'mock', name: 'Mock' }
    const view = mount(); await userEvent.click(screen.getByRole('button', { name: 'Switch to X Layer' })); expect(wallet.switchChain).toHaveBeenCalledTimes(1)
    identity = { ...identity!, chainId: 196 }; wallet.session = { ...identity, id: 'mock', name: 'Mock' }; view.rerender(); await userEvent.type(screen.getByLabelText('You pay'), '2')
    expect(screen.getByRole('alert')).toHaveTextContent('Insufficient balance'); expect(trades.executePoolTrade).not.toHaveBeenCalled()
  })
  it('keeps quotes while pause blocks all new confirmations', async () => {
    vi.mocked(policy.publicSwapsEnabled).mockReturnValue(false); mount(); await userEvent.type(screen.getByLabelText('You pay'), '0.000001')
    await waitFor(() => expect(trades.getPoolTradeQuote).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Public swaps paused' })).toBeDisabled(); expect(trades.executePoolTrade).not.toHaveBeenCalled()
  })
  it('invalidates review after the wallet identity changes', async () => {
    const view = mount(); await amount(); await userEvent.click(screen.getByRole('button', { name: 'Review swap' })); identity = { ...identity!, revision: 2 }; view.rerender()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm swap' })).toBeDisabled()
    expect(screen.getByText('The form or wallet changed. Review the current quote again.')).toBeInTheDocument()
  })
  it('applies an edited slippage and protocol preference to the next quote', async () => {
    mount(); await userEvent.click(screen.getByRole('button', { name: 'Swap settings' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'V4' }))
    const tolerance = within(dialog).getByRole('textbox', { name: 'Slippage tolerance' })
    await userEvent.clear(tolerance); await userEvent.type(tolerance, '0.75')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    await amount()
    expect(trades.getPoolTradeQuote).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'v4' }), true, 1000000000000n, 75)
  })
  it('clears a cancelled review after the amount changes', async () => {
    mount(); await amount(); await userEvent.click(screen.getByRole('button', { name: 'Review swap' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close dialog' }))
    await userEvent.clear(screen.getByLabelText('You pay')); await userEvent.type(screen.getByLabelText('You pay'), '0.000002')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(trades.executePoolTrade).not.toHaveBeenCalled()
  })
  it('recovers a submitted transaction and never resumes wallet writes', async () => {
    recordTransaction({ chainId: 196, account: owner, hash, to: CONTRACTS.router, kind: 'swap', status: 'pending', submittedAt: Date.now() })
    vi.spyOn(receipts, 'receiptStatus').mockResolvedValue('success'); mount()
    expect(screen.getByText('A previously submitted transaction was restored. No transaction is resent automatically.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Check receipt' })); await waitFor(() => expect(readTransactions(owner)[0].status).toBe('success'))
    expect(trades.executePoolTrade).not.toHaveBeenCalled(); expect(wallet.session?.provider.request).not.toHaveBeenCalled()
  })
})
