import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { encodeFunctionResult } from 'viem'
import * as liquidity from '../src/liquidity'
import { tokenAbi } from '../src/liquidity/abis'
import { WOKB_ADDRESS } from '../src/domain/assets'
import type { Eip1193Provider } from '../src/lib/wallet'
import { PREFERENCES_KEY } from '../src/preferences/model'
import { POOLS } from '../src/trading/config'
import * as policy from '../../trading-policy'

const deploymentReady = POOLS.ready

function renderApp(): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(true)
  // Display preferences and empty search do not depend on a live pool index.
  POOLS.ready = false
  vi.spyOn(liquidity, 'listAllPools').mockResolvedValue([])
  vi.spyOn(liquidity, 'listPositions').mockResolvedValue([])
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: unknown, options?: RequestInit) => {
      if (String(url).startsWith('/api/reference/')) return new Response(JSON.stringify({ schemaVersion: 1, chainId: 196, source: 'uniswap', readOnly: true, tokens: [] }))
      const request = JSON.parse(String(options?.body)) as { method: string }
      const result =
        request.method === 'eth_chainId'
          ? '0xc4'
          : request.method === 'eth_blockNumber'
            ? '0x123456'
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

describe('display preferences', () => {
  it('starts in Chinese night mode, persists changes and updates the price display without inventing prices', async () => {
    const user = userEvent.setup()
    const first = renderApp()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    await user.click(screen.getByRole('button', { name: '偏好设置' }))
    expect(screen.getByRole('radio', { name: '夜间' })).toBeChecked()
    expect(screen.getByLabelText('语言')).toHaveValue('zh-CN')
    expect(screen.getByLabelText('展示货币')).toHaveValue('CNY')
    await user.selectOptions(screen.getByLabelText('语言'), 'en')
    expect(screen.getByRole('dialog', { name: 'Preferences' })).toBeVisible()
    expect(document.documentElement).toHaveAttribute('lang', 'en')
    await user.click(screen.getByRole('radio', { name: 'Night' }))
    await user.selectOptions(screen.getByLabelText('Display currency'), 'USD')
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: 'Explore' }))
    expect(await screen.findByText('Token units only. Independent fiat values and chain-wide 24-hour rankings are unavailable.')).toBeVisible()
    expect(screen.queryByText('Price (USD)')).not.toBeInTheDocument()
    expect(screen.queryByText('$ 0')).not.toBeInTheDocument()
    first.unmount()
    renderApp()
    expect(document.documentElement).toHaveAttribute('lang', 'en')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    await user.click(screen.getByRole('button', { name: 'Preferences' }))
    expect(screen.getByLabelText('Display currency')).toHaveValue('USD')
    expect(screen.getByRole('radio', { name: 'Night' })).toBeChecked()
  })

  it.each(['broken json', JSON.stringify({ locale: 'xx', theme: 'purple', currency: 'BTC' }), '[]', 'null'])(
    'falls back safely for invalid stored preferences %s',
    async (stored) => {
      localStorage.setItem(PREFERENCES_KEY, stored)
      renderApp()
      expect(document.documentElement).toHaveAttribute('lang', 'zh-CN')
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
      await userEvent.click(screen.getByRole('button', { name: '偏好设置' }))
      expect(screen.getByLabelText('展示货币')).toHaveValue('CNY')
    },
  )

  it('remains operable when browser storage cannot be accessed', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    renderApp()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    await user.click(screen.getByRole('button', { name: '偏好设置' }))
    await user.selectOptions(screen.getByLabelText('语言'), 'yue-HK')
    await user.click(screen.getByRole('radio', { name: '夜間' }))
    expect(screen.getByRole('dialog', { name: '偏好設定' })).toBeVisible()
    expect(document.documentElement).toHaveAttribute('lang', 'yue-HK')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('preserves wallet, amount, direction and protocol when language, theme and currency change', async () => {
    const user = userEvent.setup()
    const request = vi
      .fn()
      .mockImplementation(async ({ method }: { method: string }) =>
        method === 'eth_requestAccounts' ? ['0x1111111111111111111111111111111111111111'] : '0xc4',
      )
    ;(window as Window & { ethereum?: Eip1193Provider }).ethereum = { request }
    renderApp()
    await screen.findByText('X Layer 已连接')
    const card = await screen.findByRole('region', { name: '资产兑换' })
    await user.click(within(card).getByRole('button', { name: '连接钱包' }))
    await user.click(screen.getByRole('button', { name: /浏览器钱包.*连接/ }))
    await screen.findByRole('dialog', { name: '我的钱包' })
    await user.click(screen.getByRole('button', { name: '关闭对话框' }))
    await user.click(within(card).getByRole('button', { name: '切换支付与接收资产' }))
    await user.type(within(card).getByLabelText('你将支付'), '0.5')
    await user.click(within(card).getByRole('button', { name: '兑换设置' }))
    await user.click(screen.getByRole('radio', { name: 'V3' }))
    await user.click(screen.getByRole('button', { name: '关闭对话框' }))
    await user.click(screen.getByRole('button', { name: '偏好设置' }))
    await user.selectOptions(screen.getByLabelText('语言'), 'en')
    await user.selectOptions(screen.getByLabelText('Display currency'), 'HKD')
    await user.click(screen.getByRole('radio', { name: 'Night' }))
    await user.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(screen.getByRole('region', { name: 'Asset swap' })).toBe(card)
    expect(within(card).getByLabelText('You pay')).toHaveValue('0.5')
    expect(within(card).getByRole('button', { name: 'Choose pay asset, currently USD₮0' })).toBeVisible()
    expect(within(card).getByRole('button', { name: 'Route · V3' })).toBeVisible()
    expect(within(card).getByText('No initialized SodaDEX pool for this pair.')).toBeVisible()
    expect(within(card).getByRole('button', { name: 'Review swap' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '0x1111…1111' })).toBeVisible()
    const nav = within(screen.getByRole('navigation', { name: 'Main navigation' }))
    await user.click(nav.getByRole('button', { name: 'Explore' })); await screen.findByRole('heading', { name: 'Explore X Layer' })
    await user.click(nav.getByRole('button', { name: 'Trade' }))
    expect(screen.getByRole('region', { name: 'Asset swap' })).toBe(card)
    expect(within(card).getByLabelText('You pay')).toHaveValue('0.5')
    expect(within(card).getByRole('button', { name: 'Route · V3' })).toBeVisible()
    expect(request.mock.calls.map(([args]) => args.method)).toEqual(['eth_requestAccounts', 'eth_chainId'])
  })
})

describe('localized paths', () => {
  it.each([
    {
      locale: 'zh-CN',
      pay: '你将支付',
      error: '数量需要大于 0',
      region: '资产兑换',
      connect: '连接钱包',
      empty: '尚未检测到浏览器钱包',
      title: '连接钱包',
    },
    {
      locale: 'en',
      pay: 'You pay',
      error: 'Amount must be greater than 0',
      region: 'Asset swap',
      connect: 'Connect wallet',
      empty: 'No browser wallet detected',
      title: 'Connect wallet',
    },
    {
      locale: 'yue-HK',
      pay: '你會支付',
      error: '數量要大過 0',
      region: '資產兌換',
      connect: '連接銀包',
      empty: '未搵到瀏覽器銀包',
      title: '連接銀包',
    },
  ])(
    'translates validation and wallet states in $locale',
    async ({ locale, pay, error, region, connect, empty, title }) => {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale }))
      const user = userEvent.setup()
      renderApp()
      const card = await screen.findByRole('region', { name: region })
      await user.type(within(card).getByLabelText(pay), '0')
      expect(within(card).getByRole('alert')).toHaveTextContent(error)
      await user.click(within(card).getByRole('button', { name: connect }))
      expect(screen.getByRole('dialog', { name: title })).toBeVisible()
      expect(screen.getByRole('heading', { name: empty })).toBeVisible()
    },
  )
})

describe('global search', () => {
  it('finds a token by name and opens its chain-backed Explore detail', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(screen.getByRole('button', { name: '搜索' }))
    const dialog = screen.getByRole('dialog', { name: '搜索' })
    await user.type(within(dialog).getByLabelText('搜索名称、代号或地址'), 'wrapped')
    await user.click(within(dialog).getByRole('button', { name: /WOKB/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'WOKB' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '探索 X Layer' })).toBeVisible()
    expect(window.location.hash).toBe('#explore')
  })

  it('returns from token search through Swap to Portfolio Overview with consistent hashes', async () => {
    const user = userEvent.setup()
    const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_requestAccounts' ? ['0x1111111111111111111111111111111111111111'] : '0xc4')
    ;(window as Window & { ethereum?: Eip1193Provider }).ethereum = { request }
    renderApp()
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: '连接钱包' }))
    await user.click(screen.getByRole('button', { name: /浏览器钱包.*连接/ }))
    await screen.findByRole('dialog', { name: '我的钱包' }); await user.click(screen.getByRole('button', { name: '关闭对话框' }))
    await user.click(screen.getByRole('button', { name: '搜索' })); await user.type(screen.getByLabelText('搜索名称、代号或地址'), 'wrapped')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /WOKB/ }))
    await screen.findByRole('heading', { name: 'WOKB' }); expect(window.location.hash).toBe('#explore')
    const nav = within(screen.getByRole('navigation', { name: '主导航' }))
    await user.click(nav.getByRole('button', { name: '交易' })); expect(window.location.hash).toBe('#swap')
    await user.click(nav.getByRole('button', { name: '投资组合' }))
    expect(await screen.findByRole('tab', { name: '概览' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '代币' })).toHaveAttribute('aria-selected', 'false')
    expect(window.location.hash).toBe('#portfolio')
    expect(request.mock.calls.map(([args]) => args.method)).toEqual(['eth_requestAccounts', 'eth_chainId'])
  })

  it('returns to the swap form when browser Back restores an empty hash', async () => {
    const user = userEvent.setup()
    renderApp()
    const card = await screen.findByRole('region', { name: '资产兑换' })
    await user.type(within(card).getByLabelText('你将支付'), '0.25')
    await user.click(screen.getByRole('button', { name: '投资组合' })); expect(window.location.hash).toBe('#portfolio')
    window.history.back()
    await waitFor(() => expect(window.location.hash).toBe(''))
    expect(await screen.findByRole('region', { name: '资产兑换' })).toBeVisible()
    expect(within(card).getByLabelText('你将支付')).toHaveValue('0.25')
    expect(screen.getByRole('button', { name: '交易' })).toHaveAttribute('aria-current', 'page')
  })

  it('supports filtered empty states, exact addresses, clear and Escape', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(screen.getByRole('button', { name: '搜索' }))
    const dialog = screen.getByRole('dialog', { name: '搜索' })
    const input = within(dialog).getByLabelText('搜索名称、代号或地址')
    await user.type(input, 'unknown-token')
    expect(within(dialog).getByText('没有匹配的结果')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: '流动池' }))
    expect(within(dialog).getByText('暂无可搜索的资金池。')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: '钱包' }))
    await user.clear(input)
    await user.type(input, '0x123')
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument()
    await user.clear(input)
    await user.type(input, WOKB_ADDRESS)
    expect(within(dialog).getByRole('link')).toHaveAttribute(
      'href',
      `https://www.oklink.com/xlayer/address/${WOKB_ADDRESS}`,
    )
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    await waitFor(() => expect(input).toHaveValue(''))
    expect(input).toHaveFocus()
    expect(dialog).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: '代币' }))
    await user.type(input, WOKB_ADDRESS.toLowerCase())
    expect(within(dialog).getByRole('button', { name: /WOKB/ })).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: '清空搜索' }))
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
  })
})
