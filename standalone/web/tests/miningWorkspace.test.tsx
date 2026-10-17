import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Hex } from 'viem'
import { MiningProductsWorkspace } from '../src/mining/ProductsWorkspace'
import type { WalletController } from '../src/lib/useWallet'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { miningTestDeployment, miningTestRpc, MINING_TEST_ACCOUNT } from './fixtures/miningProducts'

vi.mock('../src/network', async () => {
  const { networkProfile } = await import('../../network-profile')
  return { NETWORK: networkProfile('1952-mining-test') }
})
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

describe('1952 mining wallet workspace', () => {
  it('previews a quote, confirms exact approval and swap, and keeps the submitted history', async () => {
    const d = miningTestDeployment(), read = miningTestRpc(d, (name) => name === 'quoteExactIn' ? 10n ** 18n : undefined)
    let count = 0, latest: { from: string; to: string } | undefined
    const request = vi.fn(async (args: { method: string; params?: unknown[] }): Promise<unknown> => {
      if (args.method === 'eth_chainId') return '0x7a0'
      if (args.method === 'eth_accounts') return [MINING_TEST_ACCOUNT]
      if (args.method === 'eth_sendTransaction') { latest = args.params![0] as typeof latest; count++; return `0x${count.toString(16).padStart(64, '0')}` }
      throw new Error('Unexpected wallet method')
    })
    const identity = { address: MINING_TEST_ACCOUNT, chainId: 1952, provider: { request }, revision: 1 }
    const wallet: WalletController = { options: [], session: { ...identity, id: 'fixture', name: 'Fixture wallet' }, status: 'idle', error: undefined,
      connect: async () => {}, switchChain: async () => {}, disconnect: () => {}, getIdentity: () => identity }
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { method: Parameters<typeof read>[0]; params: unknown[]; id: string }
      const result = body.method === 'eth_getTransactionReceipt' ? { ...latest, transactionHash: body.params[0], status: '0x1', blockHash: `0x${'b'.repeat(64)}` as Hex }
        : await read(body.method, body.params)
      return Response.json({ jsonrpc: '2.0', id: body.id, result })
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(<QueryClientProvider client={client}><PreferencesProvider><MiningProductsWorkspace deployment={d} wallet={wallet} /></PreferencesProvider></QueryClientProvider>)
    expect(await screen.findByText('合约与实现版本已核验')).toBeVisible()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '矿机碎片' }))
    const card = screen.getByRole('heading', { name: '兑换' }).closest('section')!
    await user.type(within(card).getByRole('textbox', { name: '数量' }), '0.001')
    await user.click(within(card).getByRole('button', { name: '预览交易' }))
    const dialog = await screen.findByRole('dialog', { name: '确认交易内容' })
    expect(within(dialog).getByText('0.995 TEST-fFAB')).toBeVisible()
    expect(request.mock.calls.some(([a]) => a.method === 'eth_sendTransaction')).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: '前往钱包确认' }))
    expect(await screen.findByText('交易成功')).toBeVisible()
    expect(request.mock.calls.filter(([a]) => a.method === 'eth_sendTransaction')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: '交易记录' }))
    expect(screen.getAllByText('成功')).toHaveLength(2)
  })
  it('keeps booked claims available while the mining source is paused', async () => {
    const d = miningTestDeployment(), read = miningTestRpc(d, (name) => name === 'paused' ? true : undefined)
    const request = vi.fn(), identity = { address: MINING_TEST_ACCOUNT, chainId: 1952, provider: { request }, revision: 1 }
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { method: Parameters<typeof read>[0]; params: unknown[]; id: string }
      return Response.json({ jsonrpc: '2.0', id: body.id, result: await read(body.method, body.params) })
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(<QueryClientProvider client={client}><PreferencesProvider><MiningProductsWorkspace deployment={d} wallet={{ options: [], session: { ...identity, id: 'fixture', name: 'Fixture' },
      status: 'idle', error: undefined, connect: async () => {}, switchChain: async () => {}, disconnect: () => {}, getIdentity: () => identity }} /></PreferencesProvider></QueryClientProvider>)
    expect(await screen.findByText(/矿机已暂停：/)).toBeVisible()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '我的收益' }))
    const claims = await screen.findAllByRole('button', { name: '领取已入账分红' })
    expect(claims).toHaveLength(3)
    for (const claim of claims) expect(claim).toBeEnabled()
    await user.click(claims[0])
    expect(await screen.findByRole('dialog', { name: '确认交易内容' })).toBeVisible()
    expect(request).not.toHaveBeenCalled()
  })
  it('disables direct resubmission when the wallet loses the result after sending', async () => {
    const d = miningTestDeployment(), read = miningTestRpc(d)
    const request = vi.fn(async ({ method }: { method: string }): Promise<unknown> => {
      if (method === 'eth_chainId') return '0x7a0'
      if (method === 'eth_accounts') return [MINING_TEST_ACCOUNT]
      throw new Error('Wallet transport lost after broadcast')
    })
    const identity = { address: MINING_TEST_ACCOUNT, chainId: 1952, provider: { request }, revision: 1 }
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { method: Parameters<typeof read>[0]; params: unknown[]; id: string }
      return Response.json({ jsonrpc: '2.0', id: body.id, result: await read(body.method, body.params) })
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    render(<QueryClientProvider client={client}><PreferencesProvider><MiningProductsWorkspace deployment={d} wallet={{ options: [], session: { ...identity, id: 'fixture', name: 'Fixture' },
      status: 'idle', error: undefined, connect: async () => {}, switchChain: async () => {}, disconnect: () => {}, getIdentity: () => identity }} /></PreferencesProvider></QueryClientProvider>)
    expect(await screen.findByText('合约与实现版本已核验')).toBeVisible()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '我的收益' }))
    const card = screen.getByRole('heading', { name: '碎片持有人分红' }).closest('section')!
    await user.click(await within(card).findByRole('button', { name: '领取已入账分红' }))
    const dialog = screen.getByRole('dialog'), confirm = within(dialog).getByRole('button', { name: '前往钱包确认' })
    expect(within(dialog).getByText('1 TEST-FAB')).toBeVisible()
    await user.click(confirm)
    expect(await within(dialog).findByText(/钱包没有返回可核验的哈希/)).toBeVisible()
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(request.mock.calls.filter(([args]) => args.method === 'eth_sendTransaction')).toHaveLength(1)
  })
})
