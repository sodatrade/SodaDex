import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { LimitOrderPanel } from '../src/features/orders/LimitOrderPanel'
import * as liquidity from '../src/liquidity'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { PREFERENCES_KEY } from '../src/preferences/model'
import { readTransactions } from '../src/features/history/journal'
import * as receipts from '../src/trading/receipts'
import { TradeError } from '../src/trading/types'
import * as api from '../src/features/orders/api'
import { draftOrder } from '../src/features/orders/model'
import { decodeFunctionData } from 'viem'
import { orderReadAbi } from '../src/features/orders/signing'
import { readOrderSubmissions } from '../src/features/orders/OrderJournal'
import { marketOwner, marketV3 } from './tradeMarketFixture'
import { orderDeployment, orderUiFixture } from './ordersUiFixture'
vi.mock('../src/features/orders/config', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/features/orders/config')>(), ORDER_DEPLOYMENT: undefined,
}))
let f: ReturnType<typeof orderUiFixture>, client: QueryClient
function mount(deployed = true) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const tree = () => <QueryClientProvider client={client}><PreferencesProvider><LimitOrderPanel wallet={f.wallet} deployment={deployed ? orderDeployment : undefined} onConnect={vi.fn()} onSwap={vi.fn()} /></PreferencesProvider></QueryClientProvider>
  const view = render(tree())
  return { ...view, refresh: () => view.rerender(tree()) }
}
async function draft(): Promise<void> {
  await waitFor(() => expect(screen.getByText('Balance: 1 WOKB')).toBeInTheDocument())
  await userEvent.type(screen.getByLabelText('Sell amount'), '0.01')
  await userEvent.type(screen.getByLabelText('Minimum receive'), '1.234567')
  fireEvent.change(screen.getByLabelText('Expiry'), { target: { value: '2035-01-01T12:30' } })
}
async function review(): Promise<HTMLElement> { await draft(); await userEvent.click(screen.getByRole('button', { name: 'Review limit order' })); return screen.getByRole('dialog') }
function posts(): unknown[] { return f.fetcher.mock.calls.filter(([url, options]) => url === '/api/orders' && options?.method === 'POST') }
beforeEach(() => {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale: 'en', theme: 'light' }))
  f = orderUiFixture(); vi.stubGlobal('fetch', f.fetcher)
  vi.spyOn(liquidity, 'listPools').mockResolvedValue([marketV3])
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('limit order wallet and publication flow', () => {
  it('does not sign, approve, or POST when deployment is absent', async () => {
    mount(false); await draft()
    expect(screen.getByRole('button', { name: 'Review limit order' })).toBeDisabled()
    expect(screen.getAllByText(/await a ready deployment/).length).toBeGreaterThan(0)
    expect(f.methods).toEqual([]); expect(posts()).toEqual([])
  })
  it('does not authorize when the service does not match an execution-ready deployment', async () => {
    f.notReady(); mount(); await draft()
    expect(screen.getByRole('button', { name: 'Review limit order' })).toBeDisabled()
    expect(f.methods).toEqual([]); expect(posts()).toEqual([])
  })
  it('freezes exact amounts and nonce in a wallet-free review, then signs and publishes once', async () => {
    mount(); const dialog = await review()
    expect(within(dialog).getByText('1.234567 USD₮0')).toBeInTheDocument()
    const nonce = within(dialog).getByText('Nonce').nextElementSibling?.textContent
    expect(f.methods).toEqual([]); expect(posts()).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' }))
    await screen.findByText(/Order accepted by the service/)
    expect(posts()).toHaveLength(1); expect(f.methods.filter(m => m === 'eth_signTypedData_v4')).toHaveLength(1)
    expect(f.records[0].order).toMatchObject({ amountIn: '10000000000000000', minAmountOut: '1234567', nonce })
    expect(localStorage.getItem('sodadex.order-submissions.v1')).not.toContain('signature')
    expect(readTransactions()[0].kind).toBe('limit approval')
  })
  it('keeps one digest after POST timeout, queries it, and never repeats the signature or POST', async () => {
    f.timeout(); mount(); const dialog = await review()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' }))
    await screen.findByText(/Submission result is unknown/)
    const id = f.records[0].id; expect(screen.getByText(id)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Query this order' }))
    await screen.findByText(/Order accepted by the service/)
    expect(posts()).toHaveLength(1); expect(f.methods.filter(m => m === 'eth_signTypedData_v4')).toHaveLength(1)
  })
  it('does not replace an ambiguous order when a lookup returns 404', async () => {
    f.timeout(); f.missing(); mount(); const dialog = await review()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' })); await screen.findByText(/Submission result is unknown/)
    await userEvent.click(screen.getByRole('button', { name: 'Query this order' }))
    await screen.findByText(/No order is currently returned/)
    expect(posts()).toHaveLength(1); expect(screen.queryByRole('button', { name: 'Create another order' })).not.toBeInTheDocument()
  })
  it('invalidates the reviewed authorization after an account revision', async () => {
    const view = mount(); const dialog = await review()
    act(() => { f.change(); view.refresh() }); await act(async () => { await client.invalidateQueries({ queryKey: ['order-balance'] }) })
    expect(within(dialog).getByRole('button', { name: 'Approve and sign order' })).toBeDisabled()
    expect(posts()).toHaveLength(0); expect(f.methods).toHaveLength(0)
  })
  it('stops before wallet submission when gas estimation fails', async () => {
    f.failGas(); mount(); const dialog = await review()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' }))
    await within(dialog).findByRole('alert')
    expect(f.methods).not.toContain('eth_sendTransaction'); expect(f.methods).not.toContain('eth_signTypedData_v4'); expect(posts()).toHaveLength(0)
  })
  it('retains a pending approval hash and checks it without automatically signing again', async () => {
    vi.spyOn(receipts, 'waitReceipt').mockRejectedValueOnce(new TradeError('tradePending'))
    mount(); const dialog = await review()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' }))
    await within(dialog).findByRole('button', { name: 'Check transaction receipt' })
    expect(within(dialog).getByRole('link', { name: 'View transaction' })).toHaveAttribute('href', expect.stringContaining(readTransactions()[0].hash))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Check transaction receipt' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Approve and sign order' })).toBeEnabled())
    expect(f.methods.filter(m => m === 'eth_sendTransaction')).toHaveLength(1)
    expect(f.methods).not.toContain('eth_signTypedData_v4'); expect(posts()).toHaveLength(0)
  })

  it('requires a wallet review before cancelling the exact signed nonce on chain', async () => {
    const order = draftOrder({ from: liquidity.KNOWN_CURRENCIES[1], to: liquidity.KNOWN_CURRENCIES[2], pool: marketV3, amount: '0.01', minimum: '1.234567', expiry: '2035-01-01T12:30' }, orderDeployment, marketOwner as `0x${string}`, '42', 1n)
    f.records.push(f.record(order)); mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel on chain' }))
    const dialog = screen.getByRole('dialog', { name: 'Review cancellation' })
    expect(f.methods).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm cancellation' }))
    await within(dialog).findByText(/Transaction confirmed/)
    const send = f.provider.request.mock.calls.find(([r]) => r.method === 'eth_sendTransaction')![0]
    const tx = (send.params as { to: string; data: `0x${string}` }[])[0]
    expect(tx.to).toBe(orderDeployment.settlement)
    expect(decodeFunctionData({ abi: orderReadAbi, data: tx.data })).toEqual({ functionName: 'cancel', args: [42n] })
    expect(f.methods).not.toContain('eth_signTypedData_v4'); expect(posts()).toHaveLength(0)
  })
  it('stops publication if the wallet changes during the signature prompt', async () => {
    const original = f.provider.request.getMockImplementation()!
    f.provider.request.mockImplementation(async (request) => { const value = await original(request); if (request.method === 'eth_signTypedData_v4') f.change(); return value })
    mount(); const dialog = await review()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' }))
    await within(dialog).findByRole('alert')
    expect(posts()).toHaveLength(0); expect(readOrderSubmissions(orderDeployment)).toHaveLength(0)
  })
  it('retains the original maker and digest when the wallet changes while POST completes', async () => {
    const original = api.submitOrder
    vi.spyOn(api, 'submitOrder').mockImplementation(async (...args) => { const value = await original(...args); f.change(); return value })
    mount(); const dialog = await review()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' }))
    await screen.findByText(/Order accepted by the service/)
    expect(screen.getByText(f.records[0].id)).toBeInTheDocument()
    expect(readOrderSubmissions(orderDeployment)[0].order.maker).toBe(marketOwner)
    expect(posts()).toHaveLength(1)
  })
  it('recovers a submission digest on remount without re-signing or reposting', async () => {
    f.timeout(); const view = mount(); const dialog = await review()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' })); await screen.findByText(/Submission result is unknown/)
    const count = f.methods.length; view.unmount(); mount()
    expect(await screen.findByText(f.records[0].id)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Query this order' })); await screen.findByText(/Order accepted by the service/)
    expect(f.methods).toHaveLength(count); expect(posts()).toHaveLength(1)
  })
  it.each([['zh-CN', '限价单', '出售数量'], ['yue-HK', '限價單', '出售數量']])('localizes the real order form in %s', async (locale, title, amountLabel) => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale }))
    mount(false); expect(await screen.findByRole('region', { name: title })).toBeInTheDocument()
    expect(screen.getByLabelText(amountLabel)).toBeInTheDocument(); expect(f.methods).toHaveLength(0)
  })

  it('shows validated order states and paginates read-only results without wallet requests', async () => {
    const statuses = ['open', 'pending', 'filled', 'cancelled', 'expired'] as const
    const orders = statuses.map((status, i) => ({ ...f.record(draftOrder({ from: liquidity.KNOWN_CURRENCIES[1], to: liquidity.KNOWN_CURRENCIES[2], pool: marketV3, amount: '0.01', minimum: '1', expiry: '2035-01-01T12:30' }, orderDeployment, marketOwner as `0x${string}`, String(i), 1n)), status }))
    const spy = vi.spyOn(api, 'listOrders').mockResolvedValueOnce({ orders: orders.slice(0, 2), nextCursor: 'next' }).mockResolvedValueOnce({ orders: orders.slice(2), nextCursor: null })
    mount(); await screen.findByText('Open'); expect(screen.getByText('Pending')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More orders' }))
    await screen.findByText('Expired'); expect(screen.getByText('Filled')).toBeInTheDocument(); expect(screen.getByText('Cancelled')).toBeInTheDocument()
    expect(spy).toHaveBeenLastCalledWith(marketOwner, orderDeployment, 'next')
    expect(f.methods).toHaveLength(0)
  })
  it('preserves the selected pool fee and requires explicit wrapping for native input', async () => {
    vi.mocked(liquidity.listPools).mockResolvedValue([marketV3, { ...marketV3, id: '0x4444444444444444444444444444444444444444', fee: 500 }])
    mount(); await draft()
    await userEvent.selectOptions(screen.getByLabelText('Settlement pool ID'), '0x4444444444444444444444444444444444444444')
    await userEvent.click(screen.getByRole('button', { name: 'Review limit order' }))
    expect(within(screen.getByRole('dialog')).getByText('V3 · 0.05% · 1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sell asset' }))
    const picker = screen.getByRole('dialog')
    expect(within(picker).queryByRole('button', { name: /^OKB / })).not.toBeInTheDocument()
    expect(f.methods).toHaveLength(0)
  })

  it('keeps the swap DOM and amount when App switches between Swap and Limit tabs', async () => {
    const appClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(<QueryClientProvider client={appClient}><App /></QueryClientProvider>)
    const input = await screen.findByLabelText('You pay')
    await userEvent.type(input, '0.000001')
    await userEvent.click(screen.getByRole('tab', { name: 'Limit order' }))
    await screen.findByRole('heading', { name: 'Limit order' })
    expect(input).not.toBeVisible()
    await userEvent.click(screen.getByRole('tab', { name: 'Swap' }))
    expect(screen.getByLabelText('You pay')).toBe(input); expect(input).toHaveValue('0.000001'); expect(input).toBeVisible()
    expect(f.methods).toHaveLength(0); expect(posts()).toHaveLength(0)
  })
  it('allows an explicit retry after wallet rejection with the same reviewed nonce', async () => {
    const original = f.provider.request.getMockImplementation()!
    let reject = true
    f.provider.request.mockImplementation(async request => { if (request.method === 'eth_signTypedData_v4' && reject) { reject = false; throw { code: 4001 } } return original(request) })
    mount(); const dialog = await review(), nonce = within(dialog).getByText('Nonce').nextElementSibling?.textContent
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' }))
    await within(dialog).findByRole('alert'); expect(posts()).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Check transaction receipt' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Approve and sign order' })).toBeEnabled())
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' })); await screen.findByText(/Order accepted by the service/)
    expect(f.records[0].order.nonce).toBe(nonce); expect(posts()).toHaveLength(1)
  })

  it('keeps history and on-chain cancellation available when the service rejects new orders', async () => {
    f.notReady()
    const order = draftOrder({ from: liquidity.KNOWN_CURRENCIES[1], to: liquidity.KNOWN_CURRENCIES[2], pool: marketV3, amount: '0.01', minimum: '1', expiry: '2035-01-01T12:30' }, orderDeployment, marketOwner as `0x${string}`, '73', 1n)
    f.records.push(f.record(order)); mount()
    expect(await screen.findByText('Open')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel on chain' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm cancellation' }))
    await within(screen.getByRole('dialog')).findByText(/Transaction confirmed/)
    expect(f.methods.filter(m => m === 'eth_sendTransaction')).toHaveLength(1)
    expect(f.methods).not.toContain('eth_signTypedData_v4'); expect(posts()).toHaveLength(0)
  })

  it('starts another normal order after fresh service acknowledgement while keeping the open order in My limit orders', async () => {
    const view = mount(); const dialog = await review()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' })); await screen.findByText(/Order accepted by the service/)
    const first = f.records[0]
    await userEvent.click(screen.getByRole('button', { name: 'Create another order' }))
    await waitFor(() => expect(screen.getByLabelText('Sell amount')).toBeEnabled())
    const list = screen.getByRole('region', { name: 'My limit orders' })
    expect(within(list).getByText('Open')).toBeVisible(); expect(f.records[0].id).toBe(first.id)
    expect(f.fetcher.mock.calls.some(([url]) => String(url) === `/api/orders/${first.id}`)).toBe(true)
    expect(posts()).toHaveLength(1); expect(f.methods.filter(m => m === 'eth_signTypedData_v4')).toHaveLength(1)
    expect(readOrderSubmissions(orderDeployment)[0]).toMatchObject({ released: true, releaseSource: 'service', order: first.order })
    view.unmount(); mount()
    expect(screen.getByLabelText('Sell amount')).toBeEnabled()
    expect(await within(screen.getByRole('region', { name: 'My limit orders' })).findByText('Open')).toBeVisible()
  })
  it('keeps a stale acknowledgement locked when fresh verification returns 404', async () => {
    mount(); const dialog = await review()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' })); await screen.findByText(/Order accepted by the service/)
    f.missing(); await userEvent.click(screen.getByRole('button', { name: 'Create another order' })); await screen.findByText(/No order is currently returned/)
    expect(screen.getByLabelText('Sell amount')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Create another order' })).not.toBeInTheDocument()
    expect(readOrderSubmissions(orderDeployment)[0].released).not.toBe(true)
    expect(posts()).toHaveLength(1); expect(f.methods.filter(m => m === 'eth_signTypedData_v4')).toHaveLength(1)
  })

  it('does not release a cached accepted order when fresh GET fails', async () => {
    mount(); const dialog = await review()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' })); await screen.findByText(/Order accepted by the service/)
    vi.spyOn(api, 'getOrder').mockRejectedValue(Error('service unavailable'))
    await userEvent.click(screen.getByRole('button', { name: 'Create another order' }))
    await within(screen.getByRole('region', { name: 'Limit order' })).findByRole('alert')
    expect(screen.getByLabelText('Sell amount')).toBeDisabled(); expect(readOrderSubmissions(orderDeployment)[0].released).not.toBe(true)
    expect(posts()).toHaveLength(1); expect(f.methods.filter(m => m === 'eth_signTypedData_v4')).toHaveLength(1)
  })
  it('rejects a fresh acknowledgement if the wallet revision changes while GET completes', async () => {
    mount(); const dialog = await review()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' })); await screen.findByText(/Order accepted by the service/)
    const original = api.getOrder
    vi.spyOn(api, 'getOrder').mockImplementation(async (...args) => { const found = await original(...args); f.change(); return found })
    await userEvent.click(screen.getByRole('button', { name: 'Create another order' }))
    await within(screen.getByRole('region', { name: 'Limit order' })).findByRole('alert')
    expect(readOrderSubmissions(orderDeployment)[0].released).not.toBe(true); expect(screen.getByLabelText('Sell amount')).toBeDisabled()
  })
  it('does not persist focus release from a stale GET after the order panel unmounts', async () => {
    const view = mount(); const dialog = await review()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' })); await screen.findByText(/Order accepted by the service/)
    let finish: ((value: api.PublicOrder) => void) | undefined
    vi.spyOn(api, 'getOrder').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await userEvent.click(screen.getByRole('button', { name: 'Create another order' }))
    view.unmount(); await act(async () => { finish?.(f.records[0]) })
    expect(readOrderSubmissions(orderDeployment)[0].released).not.toBe(true)
    mount(); expect(screen.getByLabelText('Sell amount')).toBeDisabled()
  })
  it('keeps an accepted order focused while a cancellation hash is pending', async () => {
    mount(); const dialog = await review()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and sign order' })); await screen.findByText(/Order accepted by the service/)
    vi.spyOn(receipts, 'waitReceipt').mockRejectedValueOnce(new TradeError('tradePending'))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel saved order on chain' }))
    const cancellation = screen.getByRole('dialog')
    await userEvent.click(within(cancellation).getByRole('button', { name: 'Confirm cancellation' }))
    await within(cancellation).findByRole('button', { name: 'Check transaction receipt' })
    await userEvent.click(within(cancellation).getByRole('button', { name: 'Close dialog' }))
    expect(screen.getByRole('button', { name: 'Create another order' })).toBeDisabled()
    expect(readOrderSubmissions(orderDeployment)[0].released).not.toBe(true)
    expect(posts()).toHaveLength(1); expect(f.methods.filter(m => m === 'eth_signTypedData_v4')).toHaveLength(1)
  })
  it('rejects precision overflow and does not invent an expiry', async () => {
    mount(); await userEvent.type(screen.getByLabelText('Minimum receive'), '0.0000001')
    expect(screen.getByLabelText('Expiry')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Review limit order' })).toBeDisabled()
    expect(f.methods).toHaveLength(0)
  })
})
