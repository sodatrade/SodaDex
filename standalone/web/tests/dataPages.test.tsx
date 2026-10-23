import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HistoryPage } from '../src/features/history/HistoryPage'
import { MarketPage } from '../src/features/market/MarketPage'
import * as api from '../src/features/market/api'
import type { WalletController } from '../src/lib/useWallet'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { recordTransaction } from '../src/features/history/journal'
const hash = `0x${'a'.repeat(64)}`
const pool: api.DexPool = { protocol: 'v3', id: `0x${'1'.repeat(40)}`, address: `0x${'1'.repeat(40)}`,
  token0: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736', token1: '0xe538905cf8410324e03A5A23C1c177a474D59b2b',
  fee: 100, tickSpacing: 1, hooks: `0x${'0'.repeat(40)}`, createdBlock: 1, source: 'manifest',
  sqrtPriceX96: '79228162514264337593543950336', tick: 0, liquidity: '100', stateError: null }
const base = { schemaVersion: 1 as const, chainId: 196 as const, asOf: { number: 10, hash, timestamp: 1 },
  coverage: { fromBlock: 1, toBlock: 10, complete: true, nextFromBlock: null } }
function mount(ui: ReactElement): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={client}><PreferencesProvider>{ui}</PreferencesProvider></QueryClientProvider>)
}
describe('market and history user paths', () => {
  it('refreshes a cold index without user action and leaves a manual refresh available', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const index = { schemaVersion: 1 as const, chainId: 196, deploymentVersion: 'test', head: base.asOf,
        indexedThrough: 1, fromBlock: 1, syncing: true, lastError: null, generation: 0 }
      const getEvents = vi.spyOn(api, 'getEvents').mockResolvedValueOnce({ ...base, index, events: [], nextCursor: null })
        .mockResolvedValue({ ...base, index: { ...index, indexedThrough: 10, syncing: false }, nextCursor: null,
          events: [{ id: 'indexed', event: 'Indexed swap', protocol: 'v3', address: pool.id, blockNumber: 10,
            blockHash: hash, transactionHash: hash, logIndex: 0, args: {}, transactionFrom: null }] })
      const wallet: WalletController = { options: [], session: undefined, error: undefined, status: 'idle', connect: vi.fn(), disconnect: vi.fn(), switchChain: vi.fn(), getIdentity: vi.fn() }
      mount(<HistoryPage wallet={wallet} onConnect={vi.fn()} />)
      await screen.findByText(/正在同步链上记录/)
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      expect(await screen.findByText('Indexed swap')).toBeVisible()
      expect(getEvents).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('button', { name: /^刷新$/ })).toBeEnabled()
    } finally { vi.useRealTimers() }
  })
  it('pages every loaded event and keeps asynchronously loaded cursor pages bounded', async () => {
    const events = Array.from({ length: 23 }, (_, i): api.DexEvent => ({ id: `event-${i}`, event: `Swap-${i}`, protocol: 'v3', address: pool.id,
      blockNumber: i + 1, blockHash: hash, transactionHash: hash, logIndex: i, args: {}, transactionFrom: null }))
    const getEvents = vi.spyOn(api, 'getEvents').mockResolvedValueOnce({ ...base, events: events.slice(0, 13), nextCursor: 'next' })
      .mockResolvedValue({ ...base, events: events.slice(13), nextCursor: null })
    const wallet: WalletController = { options: [], session: undefined, status: 'idle', error: undefined, connect: vi.fn(), disconnect: vi.fn(), switchChain: vi.fn(), getIdentity: vi.fn() }
    mount(<HistoryPage wallet={wallet} onConnect={vi.fn()} />)
    const user = userEvent.setup()
    await screen.findByText('Swap-12')
    const rows = (): HTMLElement[] => within(screen.getByRole('list')).getAllByRole('listitem')
    expect(rows()).toHaveLength(10)
    expect(screen.queryByRole('button', { name: '继续扫描' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(rows()).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: '继续扫描' }))
    await waitFor(() => expect(getEvents).toHaveBeenCalledWith({ cursor: 'next' }))
    await waitFor(() => expect(rows()).toHaveLength(10))
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(rows()).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: '上一页' }))
    expect(rows()).toHaveLength(10)
  })
  it('resets local history paging when the connected account changes', async () => {
    const owner = '0x1111111111111111111111111111111111111111', other = '0x2222222222222222222222222222222222222222'
    for (let i = 0; i < 23; i++) recordTransaction({ account: owner, chainId: 196, hash: `0x${i.toString(16).padStart(64, '0')}`, to: owner, kind: `Local-${i}`, submittedAt: i + 1, status: 'success' })
    recordTransaction({ account: other, chainId: 196, hash: `0x${'b'.repeat(64)}`, to: other, kind: 'Other account', submittedAt: 100, status: 'success' })
    const wallet: WalletController = { options: [], session: { address: owner, chainId: 196, id: 'test', name: 'Test', provider: { request: vi.fn() } }, status: 'idle', error: undefined,
      connect: vi.fn(), disconnect: vi.fn(), switchChain: vi.fn(), getIdentity: vi.fn() }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const tree = (): ReactElement => <QueryClientProvider client={client}><PreferencesProvider><HistoryPage wallet={wallet} onConnect={vi.fn()} initialScope="local" /></PreferencesProvider></QueryClientProvider>
    const view = render(tree()), user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    wallet.session = { ...wallet.session!, address: other }
    view.rerender(tree())
    expect(screen.getByText('Other account')).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByRole('navigation', { name: '分页' })).not.toBeInTheDocument()
  })
  it('shows a noninteractive loading selector and never queries market data without a pool', () => {
    vi.spyOn(api, 'getPools').mockImplementation(() => new Promise(() => {}))
    const market = vi.spyOn(api, 'getMarket')
    mount(<MarketPage />)
    expect(screen.getByRole('combobox', { name: '流动性池' })).toBeDisabled()
    expect(screen.getByRole('combobox')).toHaveTextContent('正在读取链上数据')
    expect(screen.getByRole('button', { name: '读取区间' })).toBeDisabled()
    expect(market).not.toHaveBeenCalled()
  })
  it('distinguishes failed discovery from an empty catalog and retries only the catalog', async () => {
    const getPools = vi.spyOn(api, 'getPools').mockRejectedValueOnce(Error('offline')).mockResolvedValue({ ...base, pools: [] })
    const market = vi.spyOn(api, 'getMarket'), user = userEvent.setup()
    mount(<MarketPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('数据暂不可用')
    expect(screen.getByRole('combobox')).toHaveTextContent('数据暂不可用')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('status')).toHaveTextContent('暂无可用的测试池')
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(getPools).toHaveBeenCalledTimes(2)
    expect(market).not.toHaveBeenCalled()
  })
  it('renders onchain price and raw volume without inventing fiat TVL or LP income', async () => {
    vi.spyOn(api, 'getPools').mockResolvedValue({ ...base, pools: [pool] })
    vi.spyOn(api, 'getMarket').mockResolvedValue({ ...base, pool,
      token0: { address: pool.token0, symbol: 'USD₮0', name: 'USD₮0', decimals: 6 },
      token1: { address: pool.token1, symbol: 'WOKB', name: 'WOKB', decimals: 18 }, priceToken1PerToken0: '0.008',
      volume: { token0Raw: '1234567', token1Raw: '10000000000000000' }, fees: { token0Raw: '1', token1Raw: '0', reason: null },
      reserves: { token0Raw: '2000000', token1Raw: '20000000000000000', reason: null }, tvlUsd: null, apr: null, unavailableReasons: [], priceHistory: [] })
    mount(<MarketPage />)
    expect(await screen.findByText('1 USD₮0 = 0.008 WOKB')).toBeVisible()
    expect(screen.getByRole('combobox')).toBeEnabled()
    expect(screen.getByText('1.234567 USD₮0')).toBeVisible()
    expect(screen.getByText(/不等于已领取的 LP 收入/)).toBeVisible()
    expect(screen.getByText(/暂不显示美元 TVL 或 APR/)).toBeVisible()
  })
  it('keeps a disconnected wallet out of personal history and follows the server cursor', async () => {
    const user = userEvent.setup()
    const getEvents = vi.spyOn(api, 'getEvents').mockResolvedValueOnce({ ...base, events: [], nextCursor: '1:10:20' })
      .mockResolvedValue({ ...base, events: [], nextCursor: null })
    const onConnect = vi.fn()
    const wallet: WalletController = { options: [], session: undefined, status: 'idle', error: undefined,
      connect: vi.fn(), disconnect: vi.fn(), switchChain: vi.fn(), getIdentity: vi.fn() }
    mount(<HistoryPage wallet={wallet} onConnect={onConnect} />)
    await screen.findByText('此区间没有匹配的事件。')
    await user.click(screen.getByRole('button', { name: '继续扫描' }))
    await waitFor(() => expect(getEvents).toHaveBeenCalledWith({ cursor: '1:10:20' }))
    await user.click(screen.getByRole('button', { name: '我的链上记录' }))
    await user.click(screen.getByRole('button', { name: '连接钱包查看自己的记录' }))
    expect(onConnect).toHaveBeenCalledOnce()
    expect(getEvents.mock.calls.every(([q]) => q.owner === undefined)).toBe(true)
    await user.type(screen.getByLabelText('交易哈希'), 'bad')
    await user.click(screen.getByRole('button', { name: /^查询$/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('请输入完整的 0x 开头交易哈希')
  })
})
