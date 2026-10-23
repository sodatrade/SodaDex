import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MiningMarketPanel } from '../src/mining/MiningMarketPanel'
import { loadMiningMarket } from '../src/mining/marketApi'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { miningTestDeployment, MINING_TEST_HASH } from './fixtures/miningProducts'
const d = miningTestDeployment(), token = d.contracts.fragmentVault.address, cursor = '11111111-1111-1111-1111-111111111111'
const block = { number: 200, hash: MINING_TEST_HASH, timestamp: 1700000000 }, price = '1.' + '0'.repeat(36)
const trade = (id: number) => ({ id: String(id), transactionHash: MINING_TEST_HASH, timestamp: 1700000000, blockNumber: 190, source: 'fragments', buy: true, assetRaw: '1000000000000000000', fabRaw: '100000000', price })
const page = { schemaVersion: 1, chainId: d.chainId, deploymentVersion: d.version, token: token.toLowerCase(), interval: '5m', asOf: block,
  index: { schemaVersion: 1, chainId: d.chainId, deploymentVersion: d.version, head: block, indexedThrough: 200, fromBlock: 1, syncing: false, lastError: null, generation: 0 },
  candles: [{ time: 1699999800, open: price, high: price, low: price, close: price, trades: 11 }], trades: Array.from({ length: 10 }, (_, i) => trade(i)), total: 11, nextCursor: cursor, historyLimited: false }
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })
describe('mining market UI', () => {
  it('opens a real-data chart without wallet access and replaces ten-row trade pages', async () => {
    const fetcher = vi.fn(async (url: string) => Response.json(url.includes('cursor=') ? { ...page, trades: [trade(11)], nextCursor: null } : page))
    vi.stubGlobal('fetch', fetcher)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }), user = userEvent.setup()
    render(<QueryClientProvider client={client}><PreferencesProvider><MiningMarketPanel deployment={d} token={token} symbol="TEST-fFAB" /></PreferencesProvider></QueryClientProvider>)
    expect(await screen.findByRole('img', { name: /已观察蜡烛 1/ })).toBeVisible()
    expect(fetcher).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '成交记录' }))
    expect(screen.getAllByRole('row')).toHaveLength(11)
    await user.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2))
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '上一页' }))
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(11))
    client.clear()
  })
  it('rejects another deployment and oversized trade pages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ ...page, chainId: 1 })).mockResolvedValueOnce(Response.json({ ...page, trades: [...page.trades, trade(11)] })))
    await expect(loadMiningMarket(d, token, '5m')).rejects.toThrow('indexUnavailable')
    await expect(loadMiningMarket(d, token, '5m')).rejects.toThrow('indexUnavailable')
  })
  it('shows unavailable rather than an empty chart after an index failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><PreferencesProvider><MiningMarketPanel deployment={d} token={token} symbol="TEST-fFAB" /></PreferencesProvider></QueryClientProvider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取索引')
    expect(screen.queryByRole('img')).not.toBeInTheDocument(); client.clear()
  })
})
