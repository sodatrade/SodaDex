import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomationPanel } from '../src/mining/AutomationPanel'
import * as api from '../src/mining/onlineApi'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { miningTestDeployment, MINING_TEST_ACCOUNT, MINING_TEST_HASH } from './fixtures/miningProducts'

vi.mock('../src/mining/onlineApi', async (original) => ({ ...await original<typeof import('../src/mining/onlineApi')>(), loadOnlineStatus: vi.fn(), requestOnlineCheck: vi.fn() }))
afterEach(() => { vi.restoreAllMocks() })
const status = (): api.MiningOnlineStatus => ({ admissionEnabled: true, executionEnabled: true, signer: MINING_TEST_ACCOUNT, keeper: MINING_TEST_ACCOUNT,
  budget: { capWei: '1000000000000000', spentWei: '100000000000000', reservedWei: '0' }, farm: { capacity: 10, minerCount: 1, procurementBudgetFab: '100000000' }, jobs: [] })
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.loadOnlineStatus).mockResolvedValue(status()); vi.mocked(api.requestOnlineCheck).mockResolvedValue({ queued: true, executionEnabled: true }) })
function setup(): void {
  const d = miningTestDeployment(), client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={client}><PreferencesProvider><AutomationPanel deployment={d} token={d.projects[0].token.address} disabled={false} /></PreferencesProvider></QueryClientProvider>)
}
describe('background automation UI', () => {
  it('requests a check without any wallet interaction or claiming it succeeded', async () => {
    setup(); const user = userEvent.setup(), button = await screen.findByRole('button', { name: '请求后台检查' })
    expect(screen.getByText('0.0001 / 0.001 TEST-OKB')).toBeVisible()
    await user.click(button)
    expect(await screen.findByText('检查已排队；是否执行及结果以下方任务状态为准。')).toBeVisible()
    expect(api.requestOnlineCheck).toHaveBeenCalledWith(expect.anything(), miningTestDeployment().projects[0].token.address)
    expect(api.requestOnlineCheck).toHaveBeenCalledOnce()
  })
  it('renders actual task receipts and localizes known and unknown reasons', async () => {
    vi.mocked(api.loadOnlineStatus).mockResolvedValue({ ...status(), jobs: [
      { id: 'purchase-1', kind: 'purchase', status: 'submitted', reason: '', hash: MINING_TEST_HASH, updatedAt: Date.now() },
      { id: 'conversion-1', kind: 'conversion', status: 'blocked', reason: 'gas_budget', updatedAt: Date.now() },
      { id: 'fund-1', kind: 'fund', status: 'failed', reason: 'server private diagnostic', updatedAt: Date.now() },
    ] })
    setup()
    expect(await screen.findByText('采购矿机')).toBeVisible()
    expect(screen.getByRole('link', { name: '链上交易 ↗' })).toHaveAttribute('href', `https://www.oklink.com/xlayer-test/tx/${MINING_TEST_HASH}`)
    expect(screen.getByText('本阶段 gas 预算不足')).toBeVisible()
    expect(screen.queryByText('server private diagnostic')).not.toBeInTheDocument()
  })
  it('shows an execution gate and keeps refresh available', async () => {
    vi.mocked(api.loadOnlineStatus).mockResolvedValue({ ...status(), executionEnabled: false, reason: 'execution_disabled' })
    setup()
    expect(await screen.findByText(/后台自动处理尚未启用/)).toBeVisible()
    expect(screen.getByRole('button', { name: '请求后台检查' })).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新状态' })).toBeEnabled())
    expect(api.requestOnlineCheck).not.toHaveBeenCalled()
  })
  it('does not present an empty task list as fact when the service is unavailable', async () => {
    vi.mocked(api.loadOnlineStatus).mockRejectedValue(new Error('offline'))
    setup()
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.queryByText('尚无后台任务。')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '请求后台检查' })).not.toBeInTheDocument()
  })
})
