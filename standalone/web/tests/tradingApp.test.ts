import { QueryClient } from '@tanstack/svelte-query'
import { act, render, screen, waitFor, within } from '@testing-library/svelte'
// bits-ui keeps body pointer-events off until exit animations end, which jsdom never runs.
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import { encodeFunctionResult, parseAbi, type Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.svelte'
import { STABLE_ADDRESS, WOKB_ADDRESS } from '../src/domain/assets'
import type { Eip1193Provider } from '../src/lib/wallet'
import { PREFERENCES_KEY } from '../src/preferences/model'
import { v3QuoterAbi, v4QuoterAbi } from '../src/trading/abis'
import { CONTRACTS, POOLS } from '../src/trading/config'
const owner = '0x1111111111111111111111111111111111111111'
const hash = `0x${'a'.repeat(64)}` as Hex
const deploymentReady = POOLS.ready
let requests: string[] = []
let listener: ((value: unknown) => void) | undefined
function renderApp(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(App, { props: { queryClient: client } })
}
beforeEach(() => {
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
  const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
  await user.click(within(screen.getByRole('region', { name: '资产兑换' })).getByRole('button', { name: '连接钱包' }))
  await user.click(screen.getByRole('button', { name: /浏览器钱包.*连接/ }))
  // A wallet on X Layer needs nothing more from the dialog: it closes and a toast confirms.
  await screen.findByText('钱包已连接')
  expect(screen.queryByRole('dialog', { name: '我的钱包' })).not.toBeInTheDocument()
}
/** Pool reads at fixed prices: V3 156.25 and V4 100 USD₮0 per OKB, and 0.01 WOKB in the V3 pool. */
function stubPoolReads(): void {
  const originalFetch = fetch
  const q96 = 2n ** 96n
  // V3 token0 USD₮0 / token1 WOKB: sqrt 80000 → 6.4e9 wei per unit → 156.25 USD₮0 per OKB.
  const v3Slot = encodeFunctionResult({
    abi: parseAbi(['function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)']),
    functionName: 'slot0',
    result: [q96 * 80000n, 0, 0, 0, 0, 0, true],
  })
  // V4 currency0 OKB / currency1 USD₮0: sqrt 1e-5 → 1e-10 units per wei → 100 USD₮0 per OKB.
  const v4Slot = encodeFunctionResult({
    abi: parseAbi(['function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)']),
    functionName: 'getSlot0',
    result: [q96 / 100000n, 0, 0, 0],
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      const request = JSON.parse(String(options?.body)) as { method: string; params?: { to?: string; data?: string }[] }
      const to = request.params?.[0]?.to?.toLowerCase()
      const reply = (result: unknown): Response => new Response(JSON.stringify({ result }))
      if (to === POOLS.v3Address?.toLowerCase()) return reply(v3Slot)
      if (request.method === 'eth_call' && request.params?.[0]?.data?.startsWith('0xc815641c')) return reply(v4Slot)
      if (to === WOKB_ADDRESS.toLowerCase()) return reply('0x2386f26fc10000') // 0.01 WOKB
      return originalFetch(url, options)
    }),
  )
}
describe('ready test pool user flow', () => {
  it('shows an actual quote and reviewed minimum, then only sends after the final consent and refreshes balances', async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
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
    expect(await screen.findByText('兑换成功')).toBeVisible()
    expect(screen.getByText('0.0001 OKB → USD₮0 · 余额已刷新')).toBeVisible()
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
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
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
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
    renderApp()
    await connect()
    await user.type(screen.getByLabelText('支付'), '0.0001')
    await waitFor(() => expect(screen.getByRole('button', { name: '预览兑换' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '预览兑换' }))
    await act(() => listener?.(['0x2222222222222222222222222222222222222222']))
    expect(screen.getByRole('button', { name: '确认兑换' })).toBeDisabled()
    expect(screen.getByRole('dialog', { name: '预览兑换' })).toHaveTextContent('钱包、网络或输入已变化')
    expect(requests.filter((m) => m === 'eth_sendTransaction')).toHaveLength(0)
  })
  it('validates stablecoin precision and exposes actual pool search instead of a decorative empty state', async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
    renderApp()
    await user.click(screen.getByRole('button', { name: '切换支付与接收资产' }))
    await user.type(screen.getByLabelText('支付'), '1.0000001')
    expect(screen.getByRole('alert')).toHaveTextContent('最多支持 6 位小数')
    await user.click(screen.getByRole('button', { name: '搜索' }))
    await user.click(screen.getByRole('radio', { name: '流动池' }))
    await user.click(screen.getByRole('button', { name: /OKB \/ USD₮0 · V3 \+ V4/ }))
    expect(screen.getByRole('heading', { name: 'V4 · OKB / USD₮0 · 0%' })).toBeVisible()
    expect(requests).toHaveLength(0)
  })
  it.each([
    { locale: 'en', pay: 'Pay', review: 'Review swap', confirm: 'Confirm swap', minimum: 'Minimum received' },
    { locale: 'yue-HK', pay: '支付', review: '預覽兌換', confirm: '確認兌換', minimum: '最低收取' },
  ])('localizes real trading review in $locale', async ({ locale, pay, review, confirm, minimum }) => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale, theme: 'light', currency: 'CNY' }))
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
    renderApp()
    const walletButton = screen.getAllByRole('button', { name: locale === 'en' ? 'Connect wallet' : '連接銀包' })[1]
    await user.click(walletButton)
    await user.click(
      screen.getByRole('button', { name: locale === 'en' ? /Browser wallet.*Connect/ : /瀏覽器銀包.*連接/ }),
    )
    await screen.findByText(locale === 'en' ? 'Wallet connected' : '銀包已連接')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(pay), '0.0001')
    await waitFor(() => expect(screen.getByRole('button', { name: review })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: review }))
    expect(screen.getByRole('dialog', { name: review })).toHaveTextContent(minimum)
    expect(screen.getByRole('button', { name: confirm })).toBeEnabled()
    expect(requests).not.toContain('eth_sendTransaction')
  })

  it('shows each pool price and holdings read from chain and starts a swap on the chosen protocol', async () => {
    stubPoolReads()
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
    renderApp()
    await user.click(screen.getByRole('link', { name: '流动性' }))
    const v3 = screen.getByRole('article', { name: 'V3 · WOKB / USD₮0 · 0.01%' })
    const v4 = screen.getByRole('article', { name: 'V4 · OKB / USD₮0 · 0%' })
    expect(await within(v3).findByText('1 OKB ≈ 156.25 USD₮0')).toBeVisible()
    expect(within(v4).getByText('1 OKB ≈ 100.00 USD₮0')).toBeVisible()
    expect(within(v3).getByText('0.01')).toBeVisible()
    expect(within(v4).getByText('1')).toBeVisible()
    // 0.01 × 156.25 + 2 (V3) plus 1 × 100 + 2 (V4), in USD₮0.
    expect(screen.getByText('105.5625')).toBeVisible()
    expect(within(v4).getByRole('button', { name: /添加流动性/ })).toBeDisabled()
    await user.click(within(v4).getByRole('button', { name: '用 V4 兑换' }))
    const card = screen.getByRole('region', { name: '资产兑换' })
    expect(within(card).getByRole('button', { name: '路由 · V4' })).toBeVisible()
  })

  it('keeps pool shortcuts from changing the route while a submitted swap is unresolved', async () => {
    const originalFetch = fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
        const request = JSON.parse(String(options?.body)) as { method: string }
        // The receipt never arrives, so the submitted hash keeps the form locked.
        if (request.method === 'eth_getTransactionReceipt') return new Promise<Response>(() => {})
        return originalFetch(url, options)
      }),
    )
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
    renderApp()
    await connect()
    const card = screen.getByRole('region', { name: '资产兑换' })
    await user.type(within(card).getByLabelText('支付'), '0.0001')
    await waitFor(() => expect(within(card).getByRole('button', { name: '预览兑换' })).toBeEnabled())
    await user.click(within(card).getByRole('button', { name: '预览兑换' }))
    await user.click(screen.getByRole('button', { name: '确认兑换' }))
    await screen.findByText('交易已提交，等待链上回执', { selector: '[role="dialog"] *' })
    await user.click(screen.getByRole('button', { name: '关闭对话框' }))
    await user.click(screen.getByRole('link', { name: '流动性' }))
    expect(screen.getByRole('button', { name: '用 V3 兑换' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '用 V4 兑换' })).toBeDisabled()
    await user.click(screen.getByRole('link', { name: '兑换' }))
    expect(within(card).getByRole('button', { name: '路由 · V4' })).toBeVisible()
  })

  it('shows wallet value on the assets page and starts a swap from an asset row', async () => {
    stubPoolReads()
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
    renderApp()
    await user.click(screen.getByRole('link', { name: '资产' }))
    // Disconnected: one clear call to action instead of a dash in every row.
    const page = screen.getByRole('region', { name: '认识你的链上资产。' })
    expect(within(page).getByRole('heading', { name: '连接钱包，查看你的资产' })).toBeVisible()
    await user.click(within(page).getByRole('button', { name: '连接钱包' }))
    await user.click(screen.getByRole('button', { name: /浏览器钱包.*连接/ }))
    await screen.findByText('钱包已连接')
    // 1 OKB × 100 + 0.01 WOKB × 100 + 2 USD₮0 at the V4 pool price.
    expect(await screen.findByText('≈ 103.00')).toBeVisible()
    expect(screen.getByRole('group', { name: 'WOKB' })).toHaveTextContent('暂无兑换路由')
    await user.click(screen.getByRole('button', { name: '兑换 USD₮0' }))
    expect(location.pathname).toBe('/')
    const card = screen.getByRole('region', { name: '资产兑换' })
    expect(within(card).getByRole('button', { name: '选择支付资产，当前 USD₮0' })).toBeVisible()
    expect(within(card).getByRole('button', { name: '选择接收资产，当前 OKB' })).toBeVisible()
  })
})
