import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MiningProductDeployment } from '../../mining-products'
import type { WalletController } from '../src/lib/useWallet'
import { loadMiningJournal, saveMiningSubmission } from '../src/mining/journal'
import * as api from '../src/mining/onlineApi'
import { MiningProductsWorkspace } from '../src/mining/ProductsWorkspace'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { miningTestAddress, miningTestDeployment, MINING_TEST_ACCOUNT, MINING_TEST_HASH } from './fixtures/miningProducts'

vi.mock('../src/mining/onlineApi', async (original) => ({ ...await original<typeof import('../src/mining/onlineApi')>(), loadOnlineCatalog: vi.fn() }))
vi.mock('../src/mining/protocol', async (original) => ({ ...await original<typeof import('../src/mining/protocol')>(),
  verifyMiningDeployment: vi.fn(async () => {}), productRead: vi.fn(async (_read, _to, _role, name: string) =>
    ['paused', 'protectionActive'].includes(name) ? false : name === 'protectionEndsAt' ? 0n : 100_000_000n),
}))
afterEach(() => { vi.unstubAllGlobals() })
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn(async () => Response.json({ jsonrpc: '2.0', id: '1', result: '0x1' }))) })
function extraProject(index: number): MiningProductDeployment['projects'][number] {
  const p = miningTestDeployment().projects[0]
  return { symbol: `TEST-${index}`, token: { ...p.token, address: miningTestAddress(index * 10 + 1) },
    vault: { ...p.vault, address: miningTestAddress(index * 10 + 2) }, holder: { ...p.holder, address: miningTestAddress(index * 10 + 3) } }
}
function setup(): { d: MiningProductDeployment; client: QueryClient } {
  const d = miningTestDeployment(), identity = { address: MINING_TEST_ACCOUNT, chainId: 1952, provider: { request: vi.fn() }, revision: 1 }
  const wallet: WalletController = { options: [], session: { ...identity, id: 'fixture', name: 'Fixture' }, status: 'idle', error: undefined,
    connect: async () => {}, switchChain: async () => {}, disconnect: () => {}, getIdentity: () => identity }
  saveMiningSubmission(d, { hash: MINING_TEST_HASH, from: MINING_TEST_ACCOUNT, to: d.contracts.manager.address, action: 'projectBuy', at: Date.now(), status: 'success' })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={client}><PreferencesProvider><MiningProductsWorkspace deployment={d} wallet={wallet} /></PreferencesProvider></QueryClientProvider>)
  return { d, client }
}
describe('live mining project catalog', () => {
  it('keeps selection by token through reordering and refreshes balances without changing history identity', async () => {
    const base = miningTestDeployment(), b = extraProject(40), c = extraProject(50)
    let revision = 'rev-1', projects = [b, c]
    vi.mocked(api.loadOnlineCatalog).mockImplementation(async () => api.parseOnlineCatalog(base, projects, revision))
    const { d, client } = setup(), user = userEvent.setup()
    await screen.findByRole('option', { name: c.symbol })
    await user.selectOptions(screen.getByRole('combobox', { name: '选择测试项目' }), c.token.address)
    expect(screen.getByRole('combobox', { name: '选择测试项目' })).toHaveValue(c.token.address)
    projects = [c, b]; revision = 'rev-2'
    await user.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ['mining-balances', d.version, 'rev-2'] }).some((q) => q.state.status === 'success')).toBe(true))
    expect(screen.getByRole('combobox', { name: '选择测试项目' })).toHaveValue(c.token.address)
    expect(loadMiningJournal(d)).toHaveLength(1)
    expect(loadMiningJournal(d)[0].hash).toBe(MINING_TEST_HASH)
    expect(localStorage.getItem(`sodadex:1952:mining:${d.version}`)).toContain(MINING_TEST_HASH)
    expect(api.loadOnlineCatalog).toHaveBeenCalledWith(expect.objectContaining({ version: base.version }), c.token.address)
  })
  it('retains original test projects on an online-service failure', async () => {
    vi.mocked(api.loadOnlineCatalog).mockRejectedValue(new Error('service unavailable'))
    setup()
    expect(await screen.findByText('线上服务暂时不可用，已保留现有测试项目。')).toBeVisible()
    expect(screen.getByRole('option', { name: 'TEST-A' })).toBeInTheDocument()
    for (const name of ['募资分红', '矿机碎片', '我的收益', '交易记录', '发行测试项目', '自动处理']) expect(screen.getByRole('button', { name })).toBeEnabled()
  })
})
