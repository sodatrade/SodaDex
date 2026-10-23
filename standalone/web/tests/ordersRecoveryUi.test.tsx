import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { decodeFunctionData, encodeFunctionResult, type Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LimitOrderPanel } from '../src/features/orders/LimitOrderPanel'
import { readOrderSubmissions, saveOrderSubmission } from '../src/features/orders/OrderJournal'
import { draftOrder } from '../src/features/orders/model'
import { readOrderChainState, orderReadAbi } from '../src/features/orders/signing'
import * as liquidity from '../src/liquidity'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { PREFERENCES_KEY } from '../src/preferences/model'
import * as receipts from '../src/trading/receipts'
import * as signing from '../src/features/orders/signing'
import { TradeError } from '../src/trading/types'
import type { PublicRpc } from '../src/trading/types'
import { marketHash, marketOwner, marketV3 } from './tradeMarketFixture'
import { orderDeployment, orderUiFixture } from './ordersUiFixture'
let f: ReturnType<typeof orderUiFixture>
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const tree = () => <QueryClientProvider client={client}><PreferencesProvider><LimitOrderPanel wallet={f.wallet} deployment={orderDeployment} onConnect={vi.fn()} onSwap={vi.fn()} /></PreferencesProvider></QueryClientProvider>
  const view = render(tree()); return { ...view, refresh: () => view.rerender(tree()) }
}
function seed() {
  const order = draftOrder({ from: liquidity.KNOWN_CURRENCIES[1], to: liquidity.KNOWN_CURRENCIES[2], pool: marketV3, amount: '0.01', minimum: '1.234567', expiry: '2035-01-01T12:30' }, orderDeployment, marketOwner as Hex, '42', 1n)
  const record = f.record(order)
  saveOrderSubmission({ id: record.id, order, submittedAt: 1 }, orderDeployment)
  return record
}
beforeEach(() => {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale: 'en' }))
  f = orderUiFixture(); vi.stubGlobal('fetch', f.fetcher); vi.spyOn(liquidity, 'listPools').mockResolvedValue([marketV3])
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('public submission chain recovery', () => {
  it.each(['cancelled', 'filled', 'expired'] as const)('does not describe a chain-confirmed %s order as active while the service response is stale', async status => {
    const saved = seed(); f.records.push(saved); mount()
    await userEvent.click(screen.getByRole('button', { name: 'Query this order' }))
    const activeNote = 'This order remains active in My limit orders. Creating another order does not cancel it.'
    await screen.findByText(activeNote)
    if (status === 'expired') f.chainTime(BigInt(saved.order.expiry))
    else f.nonceStatus(status === 'cancelled' ? 1 : 2)
    await userEvent.click(screen.getByRole('button', { name: 'Check on-chain authorization' }))
    await waitFor(() => expect(readOrderSubmissions(orderDeployment)[0].recovery?.status).toBe(status))
    expect(screen.queryByText(activeNote)).not.toBeInTheDocument()
    expect(f.records[0].status).toBe('open')
    expect(f.methods).toHaveLength(0)
  })
  it('recovers an unsaved POST by cancelling the same nonce, explicitly starts anew, and stays released after reload', async () => {
    f.dropPost(); const view = mount()
    await waitFor(() => expect(screen.getByText('Balance: 1 WOKB')).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('Sell amount'), '0.01'); await userEvent.type(screen.getByLabelText('Minimum receive'), '1.234567')
    fireEvent.change(screen.getByLabelText('Expiry'), { target: { value: '2035-01-01T12:30' } })
    await userEvent.click(screen.getByRole('button', { name: 'Review limit order' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve and sign order' }))
    await screen.findByText(/Submission result is unknown/)
    const saved = readOrderSubmissions(orderDeployment)[0]
    await userEvent.click(screen.getByRole('button', { name: 'Query this order' })); await screen.findByText(/No order is currently returned/)
    expect(screen.queryByRole('button', { name: 'Create another order' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel saved order on chain' }))
    const dialog = screen.getByRole('dialog', { name: 'Review cancellation' })
    expect(within(dialog).getByText(saved.order.nonce)).toBeInTheDocument(); expect(within(dialog).getByText('1.234567 USD₮0')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm cancellation' }))
    await waitFor(() => expect(readOrderSubmissions(orderDeployment)[0].recovery?.status).toBe('cancelled'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }))
    const cancel = f.provider.request.mock.calls.map(([r]) => r).filter(r => r.method === 'eth_sendTransaction').at(-1)!
    expect(decodeFunctionData({ abi: orderReadAbi, data: (cancel.params as { data: Hex }[])[0].data }).args).toEqual([BigInt(saved.order.nonce)])
    await userEvent.click(screen.getByRole('button', { name: 'Create another order' }))
    await waitFor(() => expect(screen.getByLabelText('Sell amount')).toBeEnabled())
    expect(readOrderSubmissions(orderDeployment)[0]).toMatchObject({ released: true, order: { nonce: saved.order.nonce, minAmountOut: '1234567' } })
    expect(f.methods.filter(m => m === 'eth_signTypedData_v4')).toHaveLength(1)
    expect(f.fetcher.mock.calls.filter(([url, init]) => url === '/api/orders' && init?.method === 'POST')).toHaveLength(1)
    view.unmount(); mount(); expect(screen.queryByRole('region', { name: 'This device · submission record' })).not.toBeInTheDocument(); expect(screen.getByLabelText('Sell amount')).toBeEnabled()
  })
  it('retains the exact public order when cancellation is rejected', async () => {
    const saved = seed(); f.rejectCancel(); mount()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel saved order on chain' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm cancellation' }))
    await within(screen.getByRole('dialog')).findByRole('alert')
    expect(readOrderSubmissions(orderDeployment)[0]).toMatchObject({ id: saved.id, order: saved.order })
    expect(readOrderSubmissions(orderDeployment)[0].released).not.toBe(true); expect(screen.queryByRole('button', { name: 'Create another order' })).not.toBeInTheDocument()
  })
  it.each(['different maker', 'wrong chain'])('disables cancellation for %s', async (mode) => {
    seed(); const view = mount(); act(() => { if (mode === 'different maker') f.change(); else f.wrongChain(); view.refresh() })
    expect(screen.getByRole('button', { name: 'Cancel saved order on chain' })).toBeDisabled(); expect(f.methods).toHaveLength(0)
  })
  it('does not release an open signature based on browser time or API 404', async () => {
    const saved = seed(); mount(); vi.spyOn(Date, 'now').mockReturnValue(Number(saved.order.expiry) * 1000 + 100000)
    await userEvent.click(screen.getByRole('button', { name: 'Check on-chain authorization' }))
    await waitFor(() => expect(readOrderSubmissions(orderDeployment)[0].recovery?.status).toBe('open'))
    expect(screen.queryByRole('button', { name: 'Create another order' })).not.toBeInTheDocument(); expect(screen.getByLabelText('Sell amount')).toBeDisabled()
    expect(f.methods).toHaveLength(0)
  })
  it.each(['filled', 'expired'] as const)('allows explicit recovery of an on-chain %s authorization without signing', async status => {
    const saved = seed(); if (status === 'filled') f.nonceStatus(2); else f.chainTime(BigInt(saved.order.expiry))
    mount(); await userEvent.click(screen.getByRole('button', { name: 'Check on-chain authorization' }))
    await screen.findByRole('button', { name: 'Create another order' })
    expect(screen.getByLabelText('Sell amount')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Create another order' }))
    await waitFor(() => expect(readOrderSubmissions(orderDeployment)[0].released).toBe(true))
    expect(readOrderSubmissions(orderDeployment)[0].recovery?.status).toBe(status); expect(f.methods).toHaveLength(0)
  })

  it('restores a pending cancellation hash and checks its receipt without repeating a wallet write', async () => {
    seed(); const view = mount(); vi.spyOn(receipts, 'waitReceipt').mockRejectedValueOnce(new TradeError('tradePending'))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel saved order on chain' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm cancellation' }))
    await within(screen.getByRole('dialog')).findByRole('button', { name: 'Check transaction receipt' })
    view.unmount(); mount()
    expect(screen.getByRole('button', { name: 'Cancel saved order on chain' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Check on-chain authorization' }))
    expect(await screen.findByRole('button', { name: 'Create another order' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Check transaction receipt' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create another order' })).toBeEnabled())
    expect(f.methods.filter(m => m === 'eth_sendTransaction')).toHaveLength(1); expect(f.methods).not.toContain('eth_signTypedData_v4')
  })
  it('does not dismiss a stale terminal observation when a fresh canonical read is open', async () => {
    seed(); f.nonceStatus(2); mount()
    await userEvent.click(screen.getByRole('button', { name: 'Check on-chain authorization' })); await screen.findByRole('button', { name: 'Create another order' })
    f.advance(); f.nonceStatus(0)
    await userEvent.click(screen.getByRole('button', { name: 'Create another order' }))
    await waitFor(() => expect(readOrderSubmissions(orderDeployment)[0].recovery?.status).toBe('open'))
    expect(readOrderSubmissions(orderDeployment)[0].released).not.toBe(true); expect(screen.getByLabelText('Sell amount')).toBeDisabled()
  })
  it('discards a chain recovery result when the wallet revision changes while it is read', async () => {
    seed(); vi.spyOn(signing, 'readOrderChainState').mockImplementation(async () => { f.change(); return { status: 'filled', blockNumber: '16', blockHash: marketHash as Hex, timestamp: 100 } })
    mount(); await userEvent.click(screen.getByRole('button', { name: 'Check on-chain authorization' })); await screen.findByRole('alert')
    expect(readOrderSubmissions(orderDeployment)[0].recovery).toBeUndefined(); expect(screen.queryByRole('button', { name: 'Create another order' })).not.toBeInTheDocument()
  })
  it('keeps a saved observation but refuses to release it after a fresh RPC failure', async () => {
    seed(); f.nonceStatus(2); mount(); await userEvent.click(screen.getByRole('button', { name: 'Check on-chain authorization' })); await screen.findByRole('button', { name: 'Create another order' })
    f.failState(); await userEvent.click(screen.getByRole('button', { name: 'Create another order' })); await screen.findByRole('alert')
    expect(readOrderSubmissions(orderDeployment)[0].released).not.toBe(true); expect(screen.getByLabelText('Sell amount')).toBeDisabled()
  })
})
describe('canonical chain authorization snapshot', () => {
  it('pins the nonce read to the latest block number and verifies the same header afterwards', async () => {
    const saved = seed(), calls: unknown[][] = []
    const read: PublicRpc = vi.fn(async (method, params = []) => { calls.push([method, ...params]); return method === 'eth_chainId' ? '0xc4' : method === 'eth_call' ? encodeFunctionResult({ abi: orderReadAbi, functionName: 'nonceStatus', result: 1 }) : { number: '0x10', hash: marketHash, timestamp: '0x64' } })
    expect(await readOrderChainState(saved.order, orderDeployment, read)).toMatchObject({ status: 'cancelled', blockNumber: '16', timestamp: 100 })
    expect(calls.filter(c => c[0] === 'eth_getBlockByNumber')).toEqual([['eth_getBlockByNumber', 'latest', false], ['eth_getBlockByNumber', '0x10', false]])
    expect(calls.find(c => c[0] === 'eth_call')?.[2]).toBe('0x10')
  })
  it.each(['reorg', 'bad nonce', 'wrong chain', 'missing block'])('rejects %s rather than confirming invalidation', async failure => {
    const saved = seed(); let headers = 0
    const read: PublicRpc = vi.fn(async method => { if (method === 'eth_chainId') return failure === 'wrong chain' ? '0x1' : '0xc4'; if (method === 'eth_call') return encodeFunctionResult({ abi: orderReadAbi, functionName: 'nonceStatus', result: failure === 'bad nonce' ? 3 : 1 }); headers += 1; return failure === 'missing block' ? null : { number: '0x10', hash: failure === 'reorg' && headers > 1 ? `0x${'b'.repeat(64)}` : marketHash, timestamp: '0x64' } })
    await expect(readOrderChainState(saved.order, orderDeployment, read)).rejects.toThrow()
  })
})
