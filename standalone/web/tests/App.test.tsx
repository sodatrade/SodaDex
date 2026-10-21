import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { STABLE_ADDRESS } from '../src/domain/assets'
import { encodeFunctionResult } from 'viem'
import * as liquidity from '../src/liquidity'
import { tokenAbi } from '../src/liquidity/abis'
import type { Eip1193Provider } from '../src/lib/wallet'
import { POOLS } from '../src/trading/config'
import * as policy from '../../trading-policy'

const address = '0x1111111111111111111111111111111111111111'
const methods: string[] = []
const deploymentReady = POOLS.ready

function renderApp(): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

beforeEach(() => {
  vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(true)
  // Read-only navigation uses an explicitly empty registered-pool set.
  POOLS.ready = false
  vi.spyOn(liquidity, 'listAllPools').mockResolvedValue([])
  vi.spyOn(liquidity, 'listPositions').mockResolvedValue([])
  methods.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: unknown, options?: RequestInit) => {
      if (String(url).startsWith('/api/reference/')) return new Response(JSON.stringify({ schemaVersion: 1, chainId: 196, source: 'uniswap', readOnly: true, tokens: [] }))
      const request = JSON.parse(String(options?.body)) as { method: string; params?: { to?: string }[] }
      const result =
        request.method === 'eth_chainId'
          ? '0xc4'
          : request.method === 'eth_blockNumber'
            ? '0x123456'
            : request.method === 'eth_getBalance'
              ? '0x14d1120d7b160000'
              : request.params?.[0]?.to === STABLE_ADDRESS
                ? encodeFunctionResult({ abi: tokenAbi, functionName: 'balanceOf', result: 2000000n })
                : encodeFunctionResult({ abi: tokenAbi, functionName: 'balanceOf', result: 2000000000000000000n })
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.method, result }))
    }),
  )
})

afterEach(() => {
  POOLS.ready = deploymentReady
  vi.unstubAllGlobals()
  delete (window as Window & { ethereum?: Eip1193Provider }).ethereum
})

describe('SodaDex user paths', () => {
  it('keeps browsing read-only and directs unknown Swap assets to pool creation', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByText('X Layer 已连接')
    expect(screen.getByText(/使用真实 OKB/)).toBeVisible()
    const card = await screen.findByRole('region', { name: '资产兑换' })
    await user.type(within(card).getByLabelText('你将支付'), '1')
    await user.click(within(card).getByRole('button', { name: '选择支付资产，当前 OKB' }))
    const dialog = screen.getByRole('dialog', { name: '选择币种' })
    await user.type(within(dialog).getByRole('textbox'), 'wrapped')
    expect(within(dialog).queryByRole('button', { name: /^OKB / })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /WOKB/ })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('status')).toHaveTextContent('未找到有 SodaDEX 流动性的匹配币种')
    await user.click(within(dialog).getByRole('button', { name: '关闭对话框' }))
    expect(within(card).getByRole('button', { name: '选择支付资产，当前 OKB' })).toBeVisible()
    expect(within(card).getByRole('button', { name: '选择接收资产，当前 USD₮0' })).toBeVisible()
    expect(within(card).getByLabelText('你将支付')).toHaveValue('1')
    await user.click(screen.getByRole('button', { name: '流动性' }))
    expect(await screen.findByRole('heading', { name: '流动性' })).toBeVisible()
    expect(screen.getByRole('button', { name: '创建池 / 新仓位' })).toBeVisible()
  })

  it('connects with consent, switches to X Layer, reads balances and keeps trade disabled', async () => {
    const user = userEvent.setup()
    let chain = '0x1'
    const listeners = new Map<string, (value: unknown) => void>()
    const provider: Eip1193Provider = {
      request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
        methods.push(method)
        if (method === 'eth_requestAccounts') {
          return [address]
        }
        if (method === 'wallet_switchEthereumChain') {
          chain = '0xc4'
          return null
        }
        return chain
      }),
      on: (event, listener) => {
        listeners.set(event, listener)
      },
      removeListener: (event) => {
        listeners.delete(event)
      },
    }
    ;(window as Window & { ethereum?: Eip1193Provider }).ethereum = provider
    renderApp()
    await screen.findByText('X Layer 已连接')
    expect(methods).toEqual([])
    const card = await screen.findByRole('region', { name: '资产兑换' })
    await user.click(within(card).getByRole('button', { name: '连接钱包' }))
    await user.click(screen.getByRole('button', { name: /浏览器钱包.*连接/ }))
    await screen.findByRole('dialog', { name: '我的钱包' })
    await user.click(screen.getByRole('button', { name: '关闭对话框' }))
    await user.click(within(card).getByRole('button', { name: '切换到 X Layer' }))
    await waitFor(() => expect(within(card).getByText('余额 1.5')).toBeVisible())
    expect(within(card).getByText('余额 2')).toBeVisible()
    expect(within(card).getByText('该交易对尚无已初始化的 SodaDEX 资金池。')).toBeVisible()
    expect(within(card).getByRole('button', { name: '输入数量' })).toBeDisabled()
    await user.type(within(card).getByLabelText('你将支付'), '2')
    expect(within(card).getByRole('alert')).toHaveTextContent('可用余额不足')
    act(() => {
      listeners.get('accountsChanged')?.([])
    })
    expect(within(card).getByRole('button', { name: '连接钱包' })).toBeEnabled()
    expect(within(card).queryByText('余额 1.5')).not.toBeInTheDocument()
    expect(methods).toEqual(['eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain', 'eth_chainId'])
  })

  it('allows retry after wallet authorization is rejected', async () => {
    const user = userEvent.setup()
    ;(window as Window & { ethereum?: Eip1193Provider }).ethereum = {
      request: vi.fn().mockRejectedValue({ code: 4001 }),
    }
    renderApp()
    await user.click(within(await screen.findByRole('region', { name: '资产兑换' })).getByRole('button', { name: '连接钱包' }))
    await user.click(screen.getByRole('button', { name: /浏览器钱包.*连接/ }))
    const dialog = screen.getByRole('dialog', { name: '连接钱包' })
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('已取消钱包请求'))
    expect(within(dialog).getByRole('button', { name: /浏览器钱包.*连接/ })).toBeEnabled()
  })
})
