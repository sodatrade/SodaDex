import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { HistoryPage } from '../src/features/history/HistoryPage'
import { MarketPage } from '../src/features/market/MarketPage'
import * as api from '../src/features/market/api'
import type { WalletController } from '../src/lib/useWallet'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
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
  it('renders onchain price and raw volume without inventing fiat TVL or LP income', async () => {
    vi.spyOn(api, 'getPools').mockResolvedValue({ ...base, pools: [pool] })
    vi.spyOn(api, 'getMarket').mockResolvedValue({ ...base, pool,
      token0: { address: pool.token0, symbol: 'USD₮0', name: 'USD₮0', decimals: 6 },
      token1: { address: pool.token1, symbol: 'WOKB', name: 'WOKB', decimals: 18 }, priceToken1PerToken0: '0.008',
      volume: { token0Raw: '1234567', token1Raw: '10000000000000000' }, fees: { token0Raw: '1', token1Raw: '0', reason: null },
      reserves: { token0Raw: '2000000', token1Raw: '20000000000000000', reason: null }, tvlUsd: null, apr: null, unavailableReasons: [], priceHistory: [] })
    mount(<MarketPage />)
    expect(await screen.findByText('1 USD₮0 = 0.008 WOKB')).toBeVisible()
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
