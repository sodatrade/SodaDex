import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MiningHistoryWorkspace } from '../src/mining/ChainHistoryPanel'
import { loadMiningHistory } from '../src/mining/indexApi'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { miningTestDeployment, MINING_TEST_ACCOUNT, MINING_TEST_HASH, miningTestAddress } from './fixtures/miningProducts'

vi.mock('../src/network', async () => {
  const { networkProfile } = await import('../../network-profile')
  return { NETWORK: networkProfile('1952-mining-test') }
})
const block = { number: 200, hash: MINING_TEST_HASH, timestamp: 1_760_000_000 }
const row = (id: number) => ({ id: `event-${id}`, address: miningTestAddress(1), event: 'Swapped', blockNumber: 100,
  blockHash: MINING_TEST_HASH, transactionHash: `0x${id.toString(16).padStart(64, '0')}`, logIndex: id,
  args: { amountIn: '100000000' }, transactionFrom: MINING_TEST_ACCOUNT, timestamp: block.timestamp })
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })
function fixture() {
  const deployment = miningTestDeployment()
  return { deployment, response: { schemaVersion: 1, chainId: 1952, deploymentVersion: deployment.version, asOf: block,
    index: { schemaVersion: 1, chainId: 1952, deploymentVersion: deployment.version, head: block, indexedThrough: 150,
      fromBlock: 1, syncing: true, lastError: null, generation: 0 }, events: [row(1)], nextCursor: null } }
}
describe('persistent mining history UI boundary', () => {
  it('rejects wrong deployments, oversized pages and future events', async () => {
    const { deployment, response } = fixture()
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ...response, deploymentVersion: 'other' }))
      .mockResolvedValueOnce(Response.json({ ...response, events: Array.from({ length: 11 }, (_, i) => row(i)) }))
      .mockResolvedValueOnce(Response.json({ ...response, events: [{ ...row(1), blockNumber: 151 }] }))
    vi.stubGlobal('fetch', fetcher)
    for (let i = 0; i < 3; i++) await expect(loadMiningHistory(deployment, {})).rejects.toThrow('indexUnavailable')
  })
  it('replaces rather than appends server pages, keeps local receipts and resets wallet filters', async () => {
    const { deployment, response } = fixture(), user = userEvent.setup()
    const fetcher = vi.fn(async (path: string) => Response.json({ ...response,
      events: path.includes('cursor=second') ? [row(11)] : Array.from({ length: 10 }, (_, i) => row(i + 1)),
      nextCursor: path.includes('cursor=second') ? null : 'second' }))
    vi.stubGlobal('fetch', fetcher)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><PreferencesProvider><MiningHistoryWorkspace deployment={deployment}
      account={MINING_TEST_ACCOUNT} entries={[{ hash: MINING_TEST_HASH, from: MINING_TEST_ACCOUNT, to: miningTestAddress(1),
        action: 'fragmentBuy', status: 'pending', at: 1_760_000_000_000 }]} onUpdate={vi.fn()} /></PreferencesProvider></QueryClientProvider>)
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(10))
    expect(screen.getByText(/正在同步链上记录/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '当前钱包' }))
    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining(`owner=${MINING_TEST_ACCOUNT}`), expect.anything()))
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '本机提交' }))
    expect(screen.getByRole('button', { name: '查询回执' })).toBeVisible()
    expect(screen.getByText('FAB 换碎片')).toBeVisible()
    client.clear()
  })
  it('shows a restart action after a reorg cursor, not an empty completed history', async () => {
    const { deployment } = fixture()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'CHAIN_REORGANIZED' }, { status: 409 })))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><PreferencesProvider><MiningHistoryWorkspace deployment={deployment} entries={[]} onUpdate={vi.fn()} /></PreferencesProvider></QueryClientProvider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('链上数据已更新')
    expect(screen.queryByText('当前筛选范围内暂无已收录的事件。')).not.toBeInTheDocument()
    client.clear()
  })
})
