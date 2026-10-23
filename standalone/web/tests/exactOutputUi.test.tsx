// Retained protocol integration coverage with all protocols enabled.
vi.mock('../src/domain/visibleProtocols', () => ({
  VISIBLE_POOL_PROTOCOLS: ['v2', 'v3', 'v4'], VISIBLE_POSITION_PROTOCOLS: ['v3', 'v4'],
  isVisibleProtocol: () => true,
}))
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { decodeAbiParameters, decodeFunctionData, encodeFunctionResult, parseAbiParameters, type Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeneralSwapCard } from '../src/features/swap/GeneralSwapCard'
import { TradeWorkspace } from '../src/features/trade/TradeWorkspace'
import type { TradeMarketContext } from '../src/features/trade/context'
import { readTransactions } from '../src/features/history/journal'
import * as liquidity from '../src/liquidity'
import { poolId } from '../src/liquidity/pools'
import type { WalletController } from '../src/lib/useWallet'
import * as rpcModule from '../src/lib/rpc'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { PREFERENCES_KEY } from '../src/preferences/model'
import { erc20Abi, permit2Abi, routerAbi, v4QuoterAbi } from '../src/trading/abis'
import { CONTRACTS } from '../src/trading/config'
import * as policy from '../../trading-policy'
import * as receipts from '../src/trading/receipts'
import { TradeError, type TradeIdentity } from '../src/trading/types'
import { hash, selectedPool, tradeFixture } from './poolTradeFixture'
const [native, , stable] = liquidity.KNOWN_CURRENCIES
const pool = { ...selectedPool('v4', true), currency0: native, currency1: stable, fee: 0, tickSpacing: 1 }
pool.id = poolId(pool)
const defaultBalance = { okb: 10n ** 18n, wokb: 10n ** 18n, usdt0: 1000000n }
let f: ReturnType<typeof tradeFixture>, identity: TradeIdentity, wallet: WalletController
let inputs: bigint[], quoteCount: number, beforeQuote: (() => Promise<void>) | undefined
function mount(balance = defaultBalance, workspace = false) {
  let currentBalances = balance
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const changed = vi.fn<(context: TradeMarketContext) => void>()
  const tree = (mode: 'swap' | 'limit' = 'swap') => <QueryClientProvider client={client}><PreferencesProvider>{workspace
    ? <TradeWorkspace wallet={wallet} balances={currentBalances} balancesLoading={false} balancesError={false} onConnect={vi.fn()} activeMode={mode} renderOrderPanel={() => <p>Existing limit panel</p>} />
    : <GeneralSwapCard wallet={wallet} balances={currentBalances} balancesLoading={false} balancesError={false} onConnect={vi.fn()} onContextChange={changed} />}</PreferencesProvider></QueryClientProvider>
  const view = render(tree())
  return { ...view, client, changed, rerenderMode: (mode: 'swap' | 'limit') => view.rerender(tree(mode)),
    rerenderBalance: (next: typeof defaultBalance) => { currentBalances = next; view.rerender(tree()) } }
}
beforeEach(() => {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale: 'en', theme: 'light' }))
  f = tradeFixture(pool); identity = f.identity; inputs = [1000n]; quoteCount = 0; beforeQuote = undefined
  wallet = { session: { ...identity, id: 'test', name: 'Test' }, getIdentity: () => identity,
    options: [], status: 'idle', error: undefined, connect: vi.fn(), disconnect: vi.fn(), switchChain: vi.fn() }
  vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(true)
  vi.spyOn(liquidity, 'listAllPools').mockResolvedValue([pool])
  vi.spyOn(receipts, 'waitReceipt').mockResolvedValue(undefined)
  vi.spyOn(rpcModule, 'rpc').mockImplementation(async (method, params) => {
    const tx = params?.[0] as { to?: string; data?: Hex } | undefined
    if (method === 'eth_call' && tx?.to === CONTRACTS.v4Quoter) {
      await beforeQuote?.()
      return encodeFunctionResult({ abi: v4QuoterAbi, functionName: 'quoteExactOutputSingle', result: [inputs[Math.min(quoteCount++, inputs.length - 1)], 0n] })
    }
    return f.read(method, params)
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 1, chainId: 196, tokens: [] }))))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function receive(value = '0.0005', label = 'You receive'): Promise<void> {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review swap' })).toBeEnabled())
}
async function review(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: 'Review swap' })); return screen.getByRole('dialog')
}
describe('editable receive and reviewed exact-output execution', () => {
  it('quotes receive units and sends the fixed output/cap only after final confirmation', async () => {
    mount(); await receive()
    expect(screen.getByLabelText('You pay')).toHaveValue('0.000000000000001')
    expect(screen.getByText('Maximum input: 0.000000000000001005 OKB · Keep enough OKB for network fees.')).toBeVisible()
    expect(f.submitted).toHaveLength(0); expect(identity.provider.request).not.toHaveBeenCalled()
    const dialog = await review()
    expect(within(dialog).getByText('Maximum input')).toBeVisible()
    expect(within(dialog).getByText('0.000000000000001005 OKB')).toBeVisible()
    expect(within(dialog).getByText(/received amount is fixed/)).toBeVisible()
    expect(f.submitted).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm swap' }))
    await waitFor(() => expect(f.submitted).toHaveLength(1))
    expect(BigInt(f.submitted[0].value)).toBe(1005n)
    const decoded = decodeFunctionData({ abi: routerAbi, data: f.submitted[0].data })
    expect(decoded.functionName).toBe('execute')
    const [, inner] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), decoded.args[1][0])
    expect(decodeAbiParameters(parseAbiParameters('((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)'), inner[0])[0].slice(2, 4)).toEqual([500n, 1005n])
    expect(readTransactions(identity.address)[0]).toMatchObject({ hash, kind: 'swap', status: 'success' })
    expect(screen.getByLabelText('You receive')).toHaveValue('0.0005')
  })
  it('blocks on the maximum input even when the estimated input fits the balance', async () => {
    mount({ ...defaultBalance, okb: 1000n })
    fireEvent.change(screen.getByLabelText('You receive'), { target: { value: '0.0005' } })
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('Insufficient balance')
    expect(screen.getByLabelText('You pay')).toHaveValue('0.000000000000001')
    expect(screen.getByRole('button', { name: 'Insufficient balance' })).toBeDisabled()
    expect(f.submitted).toHaveLength(0)
  })
  it('blocks final confirmation if refreshed balances no longer cover the reviewed maximum', async () => {
    const view = mount(); await receive(); const dialog = await review()
    view.rerenderBalance({ ...defaultBalance, okb: 1000n })
    expect(within(dialog).getByRole('button', { name: 'Confirm swap' })).toBeDisabled()
    expect(f.submitted).toHaveLength(0); expect(identity.provider.request).not.toHaveBeenCalled()
  })
  it('never raises the reviewed maximum when a fresh quote exceeds it', async () => {
    mount(); await receive(); const dialog = await review(); inputs = [1006n]
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm swap' }))
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/quote no longer fits/i))
    expect(within(dialog).getByText('0.000000000000001005 OKB')).toBeVisible()
    expect(f.submitted).toHaveLength(0); expect(identity.provider.request).not.toHaveBeenCalled()
  })
  it('keeps the original cap after a background quote changes while review is open', async () => {
    const view = mount(); await receive(); const dialog = await review(); inputs = [1004n]
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['swap', 'quote'] }) })
    await waitFor(() => expect(screen.getByLabelText('You pay')).toHaveValue('0.000000000000001004'))
    expect(within(dialog).getByText('0.000000000000001005 OKB')).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm swap' }))
    await waitFor(() => expect(f.submitted).toHaveLength(1))
    expect(BigInt(f.submitted[0].value)).toBe(1005n)
  })
  it('uses output decimals, hides failed estimates and restores a fresh quote without signing', async () => {
    const view = mount()
    fireEvent.change(screen.getByLabelText('You receive'), { target: { value: '0.0000001' } })
    expect(screen.getByRole('alert')).toHaveTextContent('6 decimal places'); expect(quoteCount).toBe(0)
    await receive()
    beforeQuote = async () => { throw Error('RPC unavailable') }
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['swap', 'quote'] }) })
    await screen.findByText('No route could quote this amount.')
    expect(screen.getByLabelText('You pay')).toHaveValue(''); expect(screen.getByLabelText('You receive')).toHaveValue('0.0005')
    beforeQuote = undefined
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review swap' })).toBeEnabled())
    expect(identity.provider.request).not.toHaveBeenCalled()
  })
  it('cancels a reviewed exact-output order when the form changes', async () => {
    mount(); await receive(); await review()
    fireEvent.change(screen.getByLabelText('You receive'), { target: { value: '0.0006' } })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(f.submitted).toHaveLength(0)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review swap' })).toBeEnabled())
  })
  it('invalidates a review on an identity change and stops when identity changes during preflight', async () => {
    const view = mount(); await receive(); const dialog = await review()
    identity = { ...identity, revision: 2 }; view.rerenderMode('swap')
    expect(within(dialog).getByRole('button', { name: 'Confirm swap' })).toBeDisabled()
    expect(f.submitted).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    const fresh = await review(); beforeQuote = async () => { identity = { ...identity, revision: 3 } }
    await userEvent.click(within(fresh).getByRole('button', { name: 'Confirm swap' }))
    await waitFor(() => expect(within(fresh).getAllByRole('alert').length).toBeGreaterThan(0))
    expect(f.submitted).toHaveLength(0)
  })
  it('keeps a pending hash and restores its receipt query without resending', async () => {
    vi.mocked(receipts.waitReceipt).mockRejectedValue(new TradeError('tradePending'))
    const view = mount(); await receive(); const dialog = await review()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm swap' }))
    await within(dialog).findByRole('button', { name: 'Check receipt' })
    expect(f.submitted).toHaveLength(1); expect(readTransactions(identity.address)[0]).toMatchObject({ hash, status: 'pending' })
    view.unmount(); vi.spyOn(receipts, 'receiptStatus').mockResolvedValue('success'); mount()
    await userEvent.click(screen.getByRole('button', { name: 'Check receipt' }))
    await screen.findByText('Transaction confirmed'); expect(f.submitted).toHaveLength(1)
  })
  it('keeps exact-output amounts mounted through the limit tab', async () => {
    const view = mount(defaultBalance, true); await receive(); const input = screen.getByLabelText('You receive')
    view.rerenderMode('limit'); expect(input).not.toBeVisible(); expect(input).toHaveValue('0.0005')
    view.rerenderMode('swap'); expect(screen.getByLabelText('You receive')).toBe(input); expect(input).toBeVisible()
    expect(f.submitted).toHaveLength(0)
  })
  it('uses the same reviewed maximum for ERC20 and Permit2 approvals when receiving native OKB', async () => {
    mount(); await userEvent.click(screen.getByRole('button', { name: 'Switch pay and receive assets' }))
    await receive('0.0000000000000005'); expect(screen.getByLabelText('You pay')).toHaveValue('0.001')
    const dialog = await review(); await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm swap' }))
    await waitFor(() => expect(f.submitted).toHaveLength(3))
    expect(decodeFunctionData({ abi: erc20Abi, data: f.submitted[0].data }).args?.[1]).toBe(1005n)
    expect(decodeFunctionData({ abi: permit2Abi, data: f.submitted[1].data }).args?.[2]).toBe(1005n)
    expect(f.submitted[2].value).toBe('0x0'); expect(screen.getByLabelText('You receive')).toHaveValue('0.0000000000000005')
  })
  it('preserves 1:1 wrap and unwrap when either receive amount is edited', async () => {
    mount(); await userEvent.click(screen.getByRole('button', { name: /Choose receive/ }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /WOKB/ }))
    fireEvent.change(screen.getByLabelText('You receive'), { target: { value: '0.000001' } })
    expect(screen.getByLabelText('You pay')).toHaveValue('0.000001')
    await userEvent.click(screen.getByRole('button', { name: 'Wrap' }))
    expect(within(screen.getByRole('dialog')).queryByText('Maximum input')).not.toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm swap' }))
    await waitFor(() => expect(f.submitted).toHaveLength(1)); expect(BigInt(f.submitted[0].value)).toBe(1000000000000n)
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Switch pay and receive assets' }))
    fireEvent.change(screen.getByLabelText('You receive'), { target: { value: '0.000002' } })
    expect(screen.getByLabelText('You pay')).toHaveValue('0.000002'); expect(screen.getByRole('button', { name: 'Unwrap' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Unwrap' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm swap' }))
    await waitFor(() => expect(f.submitted).toHaveLength(2)); expect(f.submitted[1].value).toBe('0x0')
  })
  it('keeps exact-output quotes read-only while paused and never asks the wallet to sign', async () => {
    vi.mocked(policy.publicSwapsEnabled).mockReturnValue(false); mount()
    fireEvent.change(screen.getByLabelText('You receive'), { target: { value: '0.0005' } })
    await waitFor(() => expect(screen.getByLabelText('You pay')).toHaveValue('0.000000000000001'))
    expect(screen.getByRole('button', { name: 'Public swaps paused' })).toBeDisabled()
    expect(identity.provider.request).not.toHaveBeenCalled()
  })
  it.each([
    ['zh-CN', '你将收到', '预览兑换', '最多支付', '指定到手数量仅支持标准代币'],
    ['en', 'You receive', 'Review swap', 'Maximum input', 'Exact output supports standard tokens only'],
    ['yue-HK', '你會收到', '預覽兌換', '最多支付', '指定到手數量只支援標準代幣'],
  ])('renders the exact-output controls and restriction in %s', async (locale, label, action, maximum, note) => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale, theme: 'light' })); mount()
    fireEvent.change(screen.getByLabelText(label), { target: { value: '0.0005' } })
    await waitFor(() => expect(screen.getByRole('button', { name: action })).toBeEnabled())
    expect(screen.getAllByText(new RegExp(maximum)).length).toBeGreaterThan(0)
    expect(screen.getByText(new RegExp(note))).toBeVisible(); expect(f.submitted).toHaveLength(0)
  })
})
