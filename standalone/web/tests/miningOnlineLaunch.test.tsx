import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WalletController } from '../src/lib/useWallet'
import type { WalletIdentity } from '../src/lib/wallet'
import { LaunchProjectPanel } from '../src/mining/LaunchProjectPanel'
import * as execution from '../src/mining/execution'
import * as api from '../src/mining/onlineApi'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { miningTestDeployment, MINING_TEST_ACCOUNT, MINING_TEST_HASH, miningTestAddress } from './fixtures/miningProducts'

vi.mock('../src/mining/execution', () => ({ executeMiningCall: vi.fn() }))
vi.mock('../src/mining/onlineApi', async (original) => ({ ...await original<typeof import('../src/mining/onlineApi')>(),
  loadOnlineStatus: vi.fn(), createLaunchChallenge: vi.fn(), prepareOnlineLaunch: vi.fn(), registerOnlineLaunch: vi.fn(),
}))
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
const form = { name: 'TEST My miner', symbol: 'TEST-NEW', metadataURI: '' }
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.loadOnlineStatus).mockResolvedValue({ admissionEnabled: true, executionEnabled: true, signer: MINING_TEST_ACCOUNT, keeper: null,
    budget: { capWei: '100', spentWei: '0', reservedWei: '0' }, farm: null, jobs: [] })
  vi.mocked(api.createLaunchChallenge).mockImplementation(async (_d, _from, requestId, normalized) => ({ requestId, form: normalized,
    expiresAt: Math.floor(Date.now() / 1000) + 120, message: 'Fixture authentication message' }))
  vi.mocked(api.prepareOnlineLaunch).mockImplementation(async (d, from, challenge) => ({ ...challenge, tx: { from, to: d.contracts.manager.address, value: '0x0', data: '0x1234' } }))
  vi.mocked(api.registerOnlineLaunch).mockResolvedValue({ project: miningTestDeployment().projects[0], revision: 'registered-2' })
  vi.mocked(execution.executeMiningCall).mockImplementation(async (context, tx, action) => {
    const entry = { hash: MINING_TEST_HASH, from: tx.from, to: tx.to, action, at: Date.now(), status: 'success' as const }
    context.onSubmission(entry); return entry
  })
})
function setup(): {
  wallet: WalletController; request: ReturnType<typeof vi.fn>; onSubmission: ReturnType<typeof vi.fn>
  onRegistered: ReturnType<typeof vi.fn>; changeIdentity: () => void; view: ReturnType<typeof render>
} {
  const d = miningTestDeployment(), request = vi.fn(async ({ method }: { method: string }): Promise<unknown> => {
    if (method === 'eth_chainId') return '0x7a0'
    if (method === 'eth_accounts') return [MINING_TEST_ACCOUNT]
    if (method === 'personal_sign') return `0x${'1'.repeat(130)}`
    throw new Error('Unexpected wallet method')
  })
  let identity: WalletIdentity = { address: MINING_TEST_ACCOUNT, chainId: 1952, provider: { request }, revision: 1 }
  const wallet: WalletController = { options: [], session: { ...identity, id: 'fixture', name: 'Fixture' }, status: 'idle', error: undefined,
    connect: async () => {}, switchChain: async () => {}, disconnect: () => {}, getIdentity: () => identity }
  const onSubmission = vi.fn(), onRegistered = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const view = render(<QueryClientProvider client={client}><PreferencesProvider><LaunchProjectPanel deployment={d} wallet={wallet} disabled={false}
    onBusy={vi.fn()} onSubmission={onSubmission} onRegistered={onRegistered} /></PreferencesProvider></QueryClientProvider>)
  return { wallet, request, onSubmission, onRegistered, view, changeIdentity: () => { identity = { ...identity, address: miningTestAddress(999), revision: 2 } } }
}
async function preview(): Promise<HTMLElement> {
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: '项目名称' }), 'My miner')
  await user.type(screen.getByRole('textbox', { name: '代币符号' }), 'new')
  const button = screen.getByRole('button', { name: '签名认证并预览' })
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
  return screen.findByRole('dialog', { name: '确认测试项目发行' })
}
describe('online launch UI and recovery', () => {
  it('authenticates first and submits exactly once only after the launch review', async () => {
    const c = setup(), dialog = await preview(), user = userEvent.setup()
    expect(c.request.mock.calls.map(([a]) => a.method)).toEqual(['eth_chainId', 'eth_accounts', 'personal_sign'])
    expect(execution.executeMiningCall).not.toHaveBeenCalled()
    expect(within(dialog).getByText(form.name)).toBeVisible()
    expect(within(dialog).getByText('5,000 TEST-FAB')).toBeVisible()
    expect(api.createLaunchChallenge).toHaveBeenCalledWith(expect.anything(), MINING_TEST_ACCOUNT, expect.any(String), form)
    await user.click(within(dialog).getByRole('button', { name: '前往钱包确认发行' }))
    await waitFor(() => expect(c.onRegistered).toHaveBeenCalledOnce())
    expect(execution.executeMiningCall).toHaveBeenCalledOnce()
    expect(api.registerOnlineLaunch).toHaveBeenCalledWith(expect.anything(), MINING_TEST_HASH)
    expect(c.onSubmission).toHaveBeenCalledWith(expect.objectContaining({ hash: MINING_TEST_HASH }))
    expect(localStorage.getItem(`sodadex:1952:mining-online:fixture-v2:${MINING_TEST_ACCOUNT}:launch`)).toBeNull()
  })
  it('keeps a confirmed hash when registration fails and recovers without another launch or signature', async () => {
    vi.mocked(api.registerOnlineLaunch).mockRejectedValueOnce(new Error('service offline'))
    const c = setup(), dialog = await preview(), user = userEvent.setup()
    await user.click(within(dialog).getByRole('button', { name: '前往钱包确认发行' }))
    expect(await screen.findByText(/暂未完成登记/)).toBeVisible()
    expect(screen.getByRole('link', { name: MINING_TEST_HASH })).toBeVisible()
    c.view.unmount()
    const restored = setup()
    await user.click(screen.getByRole('button', { name: '核验交易并登记项目' }))
    await waitFor(() => expect(restored.onRegistered).toHaveBeenCalledOnce())
    expect(restored.request).not.toHaveBeenCalled()
    expect(execution.executeMiningCall).toHaveBeenCalledOnce()
    expect(api.registerOnlineLaunch).toHaveBeenCalledTimes(2)
  })
  it('blocks automatic resubmission after an unknown broadcast and accepts a hash for registration only', async () => {
    vi.mocked(execution.executeMiningCall).mockRejectedValueOnce(new Error('miningSubmissionUnknown'))
    const c = setup(), dialog = await preview(), user = userEvent.setup()
    await user.click(within(dialog).getByRole('button', { name: '前往钱包确认发行' }))
    expect(await screen.findByText(/钱包未返回可核验哈希/)).toBeVisible()
    expect(screen.getByRole('button', { name: '签名认证并预览' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: '发行交易哈希（仅用于恢复登记）' }), MINING_TEST_HASH)
    await user.click(screen.getByRole('button', { name: '核验交易并登记项目' }))
    await waitFor(() => expect(c.onRegistered).toHaveBeenCalledOnce())
    expect(execution.executeMiningCall).toHaveBeenCalledOnce()
    expect(c.request.mock.calls.filter(([a]) => a.method === 'personal_sign')).toHaveLength(1)
  })
  it('stops after an account switch while authentication is open', async () => {
    const c = setup(), user = userEvent.setup()
    c.request.mockImplementation(async ({ method }: { method: string }): Promise<unknown> => {
      if (method === 'eth_chainId') return '0x7a0'
      if (method === 'eth_accounts') return [MINING_TEST_ACCOUNT]
      if (method === 'personal_sign') { c.changeIdentity(); return `0x${'1'.repeat(130)}` }
      throw new Error('Unexpected method')
    })
    await user.type(screen.getByRole('textbox', { name: '项目名称' }), 'My miner')
    await user.type(screen.getByRole('textbox', { name: '代币符号' }), 'new')
    await user.click(screen.getByRole('button', { name: '签名认证并预览' }))
    expect(await screen.findByText('钱包、网络或表单已变化，请重新开始认证。')).toBeVisible()
    expect(api.prepareOnlineLaunch).not.toHaveBeenCalled()
    expect(execution.executeMiningCall).not.toHaveBeenCalled()
  })
  it('retains the broadcast hash and stops registration if the wallet switches after submission', async () => {
    const c = setup()
    vi.mocked(execution.executeMiningCall).mockImplementationOnce(async (context, tx, action) => {
      const entry = { hash: MINING_TEST_HASH, from: tx.from, to: tx.to, action, at: Date.now(), status: 'success' as const }
      context.onSubmission(entry); c.changeIdentity(); return entry
    })
    const dialog = await preview(), user = userEvent.setup()
    await user.click(within(dialog).getByRole('button', { name: '前往钱包确认发行' }))
    expect(await screen.findByText('钱包、网络或表单已变化，请重新开始认证。')).toBeVisible()
    expect(api.registerOnlineLaunch).not.toHaveBeenCalled()
    expect(c.onSubmission).toHaveBeenCalledWith(expect.objectContaining({ hash: MINING_TEST_HASH }))
    expect(localStorage.getItem(`sodadex:1952:mining-online:fixture-v2:${MINING_TEST_ACCOUNT}:launch`)).toContain(MINING_TEST_HASH)
  })
  it('does not submit an expired preview', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const c = setup(), dialog = await preview(), user = userEvent.setup()
    vi.setSystemTime(Date.now() + 180_000)
    await user.click(within(dialog).getByRole('button', { name: '前往钱包确认发行' }))
    expect(await screen.findByText('本次授权已到期，请重新预览。')).toBeVisible()
    expect(execution.executeMiningCall).not.toHaveBeenCalled()
    expect(c.onRegistered).not.toHaveBeenCalled()
  })
  it('retains reverted transaction history but allows a new launch after a confirmed revert', async () => {
    vi.mocked(execution.executeMiningCall).mockImplementationOnce(async (context, tx, action) => {
      context.onSubmission({ hash: MINING_TEST_HASH, from: tx.from, to: tx.to, action, at: Date.now(), status: 'reverted' })
      throw new Error('miningReverted')
    })
    const c = setup(), dialog = await preview(), user = userEvent.setup()
    await user.click(within(dialog).getByRole('button', { name: '前往钱包确认发行' }))
    expect(await screen.findByText('交易已回退，可通过哈希查看。')).toBeVisible()
    expect(c.onSubmission).toHaveBeenCalledWith(expect.objectContaining({ hash: MINING_TEST_HASH, status: 'reverted' }))
    expect(api.registerOnlineLaunch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '签名认证并预览' })).toBeEnabled()
  })
  it('shows disabled admission honestly and does not authenticate', async () => {
    vi.mocked(api.loadOnlineStatus).mockResolvedValue({ admissionEnabled: false, executionEnabled: false, signer: MINING_TEST_ACCOUNT, keeper: null,
      budget: { capWei: '0', spentWei: '0', reservedWei: '0' }, farm: null, jobs: [] })
    const c = setup()
    expect(await screen.findByText('新项目发行尚未启用。已有项目仍可操作。')).toBeVisible()
    expect(screen.getByRole('button', { name: '签名认证并预览' })).toBeDisabled()
    expect(c.request).not.toHaveBeenCalled()
  })
})
