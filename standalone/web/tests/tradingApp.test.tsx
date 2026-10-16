import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { encodeFunctionResult, type Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { STABLE_ADDRESS } from '../src/domain/assets'
import type { Eip1193Provider } from '../src/lib/wallet'
import { PREFERENCES_KEY } from '../src/preferences/model'
import { v3QuoterAbi, v4QuoterAbi } from '../src/trading/abis'
import { CONTRACTS, POOLS } from '../src/trading/config'
import * as policy from '../../trading-policy'
import * as receipts from '../src/trading/receipts'
import { TradeError } from '../src/trading/types'
const owner = '0x1111111111111111111111111111111111111111'
const hash = `0x${'a'.repeat(64)}` as Hex
const deploymentReady = POOLS.ready
let requests: string[] = []
let listener: ((value: unknown) => void) | undefined
function renderApp(): { rerender: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const tree = () => (
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  )
  const view = render(tree())
  return { rerender: () => view.rerender(tree()) }
}
beforeEach(() => {
  vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(true)
  POOLS.ready = true
  requests = []
  listener = undefined
  const provider: Eip1193Provider = {
    request: vi.fn(async ({ method }) => {
      requests.push(method)
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [owner]
      if (method === 'eth_sendTransaction') return hash
      return '0xc4'
    }),
    on: (event, fn) => {
      if (event === 'accountsChanged') listener = fn
    },
    removeListener: () => {},
  }
  ;(window as Window & { ethereum?: Eip1193Provider }).ethereum = provider
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, options: RequestInit) => {
      const r = JSON.parse(String(options.body)) as { method: string; params?: unknown[] }
      let result: unknown
      if (r.method === 'eth_chainId') result = '0xc4'
      else if (r.method === 'eth_blockNumber') result = '0x123456'
      else if (r.method === 'eth_getBlockByNumber') result = { timestamp: '0x3e8' }
      else if (r.method === 'eth_getBalance') result = '0xde0b6b3a7640000'
      else if (r.method === 'eth_gasPrice') result = '0x1'
      else if (r.method === 'eth_estimateGas') result = '0x186a0'
      else if (r.method === 'eth_getTransactionReceipt')
        result = { transactionHash: hash, from: owner, to: CONTRACTS.router, blockHash: hash, status: '0x1' }
      else {
        const tx = r.params?.[0] as { to: string; data: string }
        result =
          tx.to === CONTRACTS.v3Quoter
            ? encodeFunctionResult({
                abi: v3QuoterAbi,
                functionName: 'quoteExactInputSingle',
                result: [999999n, 0n, 0, 0n],
              })
            : tx.to === CONTRACTS.v4Quoter
              ? encodeFunctionResult({
                  abi: v4QuoterAbi,
                  functionName: 'quoteExactInputSingle',
                  result: [1000001n, 0n],
                })
              : tx.to === STABLE_ADDRESS
                ? '0x1e8480'
                : tx.to === CONTRACTS.router
                  ? '0x'
                  : '0x0'
      }
      return new Response(JSON.stringify({ result }))
    }),
  )
})
afterEach(() => {
  POOLS.ready = deploymentReady
  vi.unstubAllGlobals()
  delete (window as Window & { ethereum?: Eip1193Provider }).ethereum
})
async function connect(): Promise<void> {
  const user = userEvent.setup()
  await user.click(within(screen.getByRole('banner')).getByRole('button', { name: '连接钱包' }))
  await user.click(screen.getByRole('button', { name: /浏览器钱包.*连接/ }))
  await screen.findByRole('dialog', { name: '我的钱包' })
  await user.click(screen.getByRole('button', { name: '关闭对话框' }))
}
describe('ready test pool user flow', () => {
  it('keeps submitted links and receipt checks available after public trading pauses', async () => {
    vi.spyOn(receipts, 'waitReceipt').mockRejectedValueOnce(new TradeError('tradePending'))
    const user = userEvent.setup()
    const view = renderApp()
    await connect()
    await user.type(screen.getByLabelText('支付'), '0.0001')
    await user.click(await screen.findByRole('button', { name: '预览兑换' }))
    await user.click(screen.getByRole('button', { name: '确认兑换' }))
    await screen.findByRole('button', { name: '检查交易回执' })
    vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(false)
    view.rerender()
    await user.click(screen.getByRole('button', { name: '关闭对话框' }))
    expect(screen.getByRole('link', { name: /最近提交/ })).toHaveAttribute('href', `https://www.oklink.com/xlayer/tx/${hash}`)
    await user.click(screen.getByRole('button', { name: '查看交易' }))
    await user.click(screen.getByRole('button', { name: '检查交易回执' }))
    await within(screen.getByRole('dialog')).findByText('兑换已确认，余额已刷新')
    await user.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: '关闭对话框' })[1])
    expect(screen.getByRole('button', { name: '公开兑换已暂停' })).toBeDisabled()
    expect(requests.filter((m) => m === 'eth_sendTransaction')).toHaveLength(1)
  })
  it.each([
    { locale: 'zh-CN', paused: '公开兑换已暂停', pay: '支付', pools: '流动性', receive: '预计接收数量', note: '测试池参考报价 · 公开兑换已暂停' },
    { locale: 'en', paused: 'Public swaps paused', pay: 'Pay', pools: 'Liquidity', receive: 'Estimated receive amount', note: 'Test pool reference quote · Public swaps paused' },
    { locale: 'yue-HK', paused: '公開兌換已暫停', pay: '支付', pools: '流動性', receive: '預計收取數量', note: '測試池參考報價 · 公開兌換已暫停' },
  ])('shows read-only quotes but pauses new trades in $locale', async ({ locale, paused, pay, pools, receive, note }) => {
    vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(false)
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale }))
    const user = userEvent.setup()
    renderApp()
    await user.type(screen.getByLabelText(pay), '1')
    await waitFor(() => expect(screen.getByLabelText(receive)).toHaveTextContent('1.000001'))
    expect(screen.getByText(note)).toBeVisible()
    expect(screen.getByRole('button', { name: paused })).toBeDisabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(POOLS.ready).toBe(true)
    await user.click(screen.getByRole('button', { name: pools }))
    expect(screen.getByRole('heading', { name: 'V3 · WOKB / USD₮0 · 0.01%' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'V4 · OKB / USD₮0 · 0%' })).toBeVisible()
    expect(requests).toHaveLength(0)
    const requestsSent = vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(String(options?.body)) as { method: string })
    expect(requestsSent.some(({ method }) => method === 'eth_call')).toBe(true)
    expect(requestsSent.some(({ method }) => method === 'eth_estimateGas')).toBe(false)
  })

  it('disables an existing review when public trading pauses before final confirmation', async () => {
    const user = userEvent.setup()
    const view = renderApp()
    await connect()
    await user.type(screen.getByLabelText('支付'), '0.0001')
    await user.click(await screen.findByRole('button', { name: '预览兑换' }))
    vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(false)
    view.rerender()
    expect(screen.getByRole('dialog', { name: '预览兑换' })).toHaveTextContent('公开兑换已暂停')
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '公开兑换已暂停' })).toBeDisabled()
    expect(requests).not.toContain('eth_sendTransaction')
  })
  it('shows an actual quote and reviewed minimum, then only sends after the final consent and refreshes balances', async () => {
    const user = userEvent.setup()
    renderApp()
    await connect()
    const card = screen.getByRole('region', { name: '资产兑换' })
    await user.type(within(card).getByLabelText('支付'), '0.0001')
    await waitFor(() => expect(within(card).getByRole('button', { name: '预览兑换' })).toBeEnabled())
    expect(within(card).getByLabelText('预计接收数量')).toHaveTextContent('1.000001')
    await user.click(within(card).getByRole('button', { name: '预览兑换' }))
    const dialog = screen.getByRole('dialog', { name: '预览兑换' })
    expect(within(dialog).getByText('0.995001 USD₮0')).toBeVisible()
    expect(requests.filter((m) => m === 'eth_sendTransaction')).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: '确认兑换' }))
    await within(dialog).findByText('兑换已确认，余额已刷新')
    expect(requests.filter((m) => m === 'eth_sendTransaction')).toHaveLength(1)
    expect(within(dialog).getByRole('link', { name: '查看交易' })).toHaveAttribute(
      'href',
      `https://www.oklink.com/xlayer/tx/${hash}`,
    )
  })
  it('keeps the submitted hash visible after closing the modal, later confirmation and a new review', async () => {
    const originalFetch = fetch
    let resolveReceipt: ((value: Response) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
        const request = JSON.parse(String(options?.body)) as { method: string }
        if (request.method === 'eth_getTransactionReceipt')
          return new Promise<Response>((resolve) => {
            resolveReceipt = resolve
          })
        return originalFetch(url, options)
      }),
    )
    const user = userEvent.setup()
    renderApp()
    await connect()
    const card = screen.getByRole('region', { name: '资产兑换' })
    await user.type(within(card).getByLabelText('支付'), '0.0001')
    await waitFor(() => expect(within(card).getByRole('button', { name: '预览兑换' })).toBeEnabled())
    await user.click(within(card).getByRole('button', { name: '预览兑换' }))
    await user.click(screen.getByRole('button', { name: '确认兑换' }))
    await waitFor(() => expect(resolveReceipt).toBeTypeOf('function'))
    await user.click(screen.getByRole('button', { name: '关闭对话框' }))
    expect(within(card).getByRole('link', { name: /最近提交/ })).toHaveAttribute(
      'href',
      `https://www.oklink.com/xlayer/tx/${hash}`,
    )
    await act(async () => {
      resolveReceipt?.(
        new Response(
          JSON.stringify({
            result: { transactionHash: hash, from: owner, to: CONTRACTS.router, blockHash: hash, status: '0x1' },
          }),
        ),
      )
    })
    await within(card).findByText('兑换已确认，余额已刷新')
    await user.click(within(card).getByRole('button', { name: '预览兑换' }))
    expect(within(card).getByRole('link', { name: /最近提交/ })).toHaveAttribute(
      'href',
      `https://www.oklink.com/xlayer/tx/${hash}`,
    )
    expect(requests.filter((m) => m === 'eth_sendTransaction')).toHaveLength(1)
  })

  it('invalidates the final confirmation if the connected account changes after review', async () => {
    const user = userEvent.setup()
    renderApp()
    await connect()
    await user.type(screen.getByLabelText('支付'), '0.0001')
    await waitFor(() => expect(screen.getByRole('button', { name: '预览兑换' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '预览兑换' }))
    act(() => listener?.(['0x2222222222222222222222222222222222222222']))
    expect(screen.getByRole('button', { name: '确认兑换' })).toBeDisabled()
    expect(screen.getByRole('dialog', { name: '预览兑换' })).toHaveTextContent('钱包、网络或输入已变化')
    expect(requests.filter((m) => m === 'eth_sendTransaction')).toHaveLength(0)
  })
  it('validates stablecoin precision and exposes actual pool search instead of a decorative empty state', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(screen.getByRole('button', { name: '切换支付与接收资产' }))
    await user.type(screen.getByLabelText('支付'), '1.0000001')
    expect(screen.getByRole('alert')).toHaveTextContent('最多支持 6 位小数')
    await user.click(screen.getByRole('button', { name: '搜索' }))
    await user.click(screen.getByRole('button', { name: '流动池' }))
    await user.click(screen.getByRole('button', { name: /OKB \/ USD₮0 · V3 \+ V4/ }))
    expect(screen.getByRole('heading', { name: 'V4 · OKB / USD₮0 · 0%' })).toBeVisible()
    expect(requests).toHaveLength(0)
  })
  it.each([
    { locale: 'en', pay: 'Pay', review: 'Review swap', confirm: 'Confirm swap', minimum: 'Minimum received' },
    { locale: 'yue-HK', pay: '支付', review: '預覽兌換', confirm: '確認兌換', minimum: '最低收取' },
  ])('localizes real trading review in $locale', async ({ locale, pay, review, confirm, minimum }) => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale, theme: 'light', currency: 'CNY' }))
    const user = userEvent.setup()
    renderApp()
    const walletButton = screen.getAllByRole('button', { name: locale === 'en' ? 'Connect wallet' : '連接銀包' })[1]
    await user.click(walletButton)
    await user.click(
      screen.getByRole('button', { name: locale === 'en' ? /Browser wallet.*Connect/ : /瀏覽器銀包.*連接/ }),
    )
    await screen.findByRole('dialog', { name: locale === 'en' ? 'My wallet' : '我嘅銀包' })
    await user.click(screen.getByRole('button', { name: locale === 'en' ? 'Close dialog' : '關閉對話框' }))
    await user.type(screen.getByLabelText(pay), '0.0001')
    await waitFor(() => expect(screen.getByRole('button', { name: review })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: review }))
    expect(screen.getByRole('dialog', { name: review })).toHaveTextContent(minimum)
    expect(screen.getByRole('button', { name: confirm })).toBeEnabled()
    expect(requests).not.toContain('eth_sendTransaction')
  })
})
