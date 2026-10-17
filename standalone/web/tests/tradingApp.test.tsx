import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { decodeFunctionData, encodeFunctionResult, zeroAddress, type Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { STABLE_ADDRESS, WOKB_ADDRESS } from '../src/domain/assets'
import type { Eip1193Provider } from '../src/lib/wallet'
import * as liquidity from '../src/liquidity'
import { factoryAbi, poolAbi, stateAbi, tokenAbi } from '../src/liquidity/abis'
import { LP_CONTRACTS } from '../src/liquidity/config'
import { poolId } from '../src/liquidity/pools'
import type { LiquidityPool } from '../src/liquidity/types'
import { PREFERENCES_KEY } from '../src/preferences/model'
import { v3QuoterAbi, v4QuoterAbi } from '../src/trading/abis'
import { CONTRACTS, POOLS } from '../src/trading/config'
import * as policy from '../../trading-policy'
import * as receipts from '../src/trading/receipts'
import { TradeError } from '../src/trading/types'
import { chartFixture } from './tradeMarketFixture'
const owner = '0x1111111111111111111111111111111111111111'
const hash = `0x${'a'.repeat(64)}` as Hex
const deploymentReady = POOLS.ready
const poolAddress = '0x3333333333333333333333333333333333333333' as const
const v4: LiquidityPool = { protocol: 'v4', id: '0x', currency0: liquidity.KNOWN_CURRENCIES[0], currency1: liquidity.KNOWN_CURRENCIES[2],
  fee: 0, tickSpacing: 1, sqrtPriceX96: 2n ** 96n, tick: 0, liquidity: 1n, initialized: true }
v4.id = poolId(v4)
const v3: LiquidityPool = { ...v4, protocol: 'v3', id: poolAddress, address: poolAddress,
  currency0: liquidity.KNOWN_CURRENCIES[2], currency1: { ...liquidity.KNOWN_CURRENCIES[0], address: WOKB_ADDRESS }, fee: 100 }
const fixturePools = [v3, v4]
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
  vi.spyOn(liquidity, 'listPools').mockResolvedValue(fixturePools)
  vi.spyOn(liquidity, 'listPositions').mockResolvedValue([])
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
    vi.fn(async (url: unknown, options?: RequestInit) => {
      if (String(url).startsWith('/api/reference/')) return new Response(JSON.stringify({ schemaVersion: 1, chainId: 196, source: 'uniswap', readOnly: true, tokens: [] }))
      if (String(url).startsWith('/api/dex/chart')) {
        const query = new URL(String(url), 'http://localhost').searchParams
        const selected = fixturePools.find((pool) => pool.id === query.get('pool'))!
        return new Response(JSON.stringify(chartFixture(selected, { interval: query.get('interval') as '5m', candles: [], trades: [], priceToken1PerToken0: null })))
      }
      if (String(url).startsWith('/api/dex/pools')) return new Response(JSON.stringify({ schemaVersion: 1, chainId: 196,
        asOf: { number: 73400320, hash, timestamp: 1000 }, coverage: { fromBlock: 73361037, toBlock: 73400320, complete: true, nextFromBlock: null }, nextCursor: null,
        pools: fixturePools.map((pool) => ({ protocol: pool.protocol, id: pool.id, address: pool.address ?? null, token0: pool.currency0.address,
          token1: pool.currency1.address, fee: pool.fee, tickSpacing: pool.tickSpacing, hooks: zeroAddress, createdBlock: 73361037,
          source: 'chain', sqrtPriceX96: pool.sqrtPriceX96.toString(), tick: pool.tick, liquidity: pool.liquidity.toString(), stateError: null })) }))
      const r = JSON.parse(String(options?.body)) as { method: string; params?: unknown[] }
      let result: unknown
      if (r.method === 'eth_chainId') result = '0xc4'
      else if (r.method === 'eth_blockNumber') result = '0x4600000'
      else if (r.method === 'eth_getBlockByNumber') result = { timestamp: '0x3e8' }
      else if (r.method === 'eth_getBalance') result = '0xde0b6b3a7640000'
      else if (r.method === 'eth_gasPrice') result = '0x1'
      else if (r.method === 'eth_estimateGas') result = '0x186a0'
      else if (r.method === 'eth_getTransactionReceipt')
        result = { transactionHash: hash, from: owner, to: CONTRACTS.router, blockHash: hash, status: '0x1' }
      else {
        const tx = r.params?.[0] as { to: string; data: Hex }
        if (tx.to === LP_CONTRACTS.factory) {
          const decoded = decodeFunctionData({ abi: factoryAbi, data: tx.data })
          result = decoded.functionName === 'getPool'
            ? encodeFunctionResult({ abi: factoryAbi, functionName: 'getPool', result: poolAddress })
            : encodeFunctionResult({ abi: factoryAbi, functionName: 'feeAmountTickSpacing', result: 1 })
        } else if (tx.to === poolAddress) {
          const decoded = decodeFunctionData({ abi: poolAbi, data: tx.data })
          result = decoded.functionName === 'slot0'
            ? encodeFunctionResult({ abi: poolAbi, functionName: 'slot0', result: [2n ** 96n, 0, 0, 0, 0, 0, true] })
            : encodeFunctionResult({ abi: poolAbi, functionName: 'liquidity', result: 1n })
        } else if (tx.to === LP_CONTRACTS.stateView) {
          const decoded = decodeFunctionData({ abi: stateAbi, data: tx.data })
          result = decoded.functionName === 'getSlot0'
            ? encodeFunctionResult({ abi: stateAbi, functionName: 'getSlot0', result: [2n ** 96n, 0, 0, 0] })
            : encodeFunctionResult({ abi: stateAbi, functionName: 'getLiquidity', result: 1n })
        } else if (tx.to === CONTRACTS.v3Quoter) result = encodeFunctionResult({ abi: v3QuoterAbi, functionName: 'quoteExactInputSingle', result: [999999n, 0n, 0, 0n] })
        else if (tx.to === CONTRACTS.v4Quoter) result = encodeFunctionResult({ abi: v4QuoterAbi, functionName: 'quoteExactInputSingle', result: [1000001n, 0n] })
        else if (tx.data.startsWith('0x70a08231')) result = encodeFunctionResult({ abi: tokenAbi, functionName: 'balanceOf', result: tx.to === STABLE_ADDRESS ? 2000000n : 2000000000000000000n })
        else if (tx.to === CONTRACTS.router) result = '0x'
        else throw Error(`Unexpected fixture RPC call ${tx.to} ${tx.data}`)
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
async function connect(locale = 'zh-CN'): Promise<void> {
  const user = userEvent.setup()
  await user.click(within(screen.getByRole('banner')).getByRole('button', { name: locale === 'en' ? 'Connect wallet' : locale === 'yue-HK' ? '連接銀包' : '连接钱包' }))
  await user.click(screen.getByRole('button', { name: locale === 'en' ? /Browser wallet.*Connect/ : locale === 'yue-HK' ? /瀏覽器銀包.*連接/ : /浏览器钱包.*连接/ }))
  await screen.findByRole('dialog', { name: locale === 'en' ? 'My wallet' : locale === 'yue-HK' ? '我嘅銀包' : '我的钱包' })
  await user.click(screen.getByRole('button', { name: locale === 'en' ? 'Close dialog' : locale === 'yue-HK' ? '關閉對話框' : '关闭对话框' }))
}
describe('ready test pool user flow', () => {
  it('keeps submitted links and receipt checks available after public trading pauses', async () => {
    vi.spyOn(receipts, 'waitReceipt').mockRejectedValueOnce(new TradeError('tradePending'))
    const user = userEvent.setup()
    const view = renderApp()
    await connect()
    await user.type(await screen.findByLabelText('你将支付'), '0.0001')
    await user.click(await screen.findByRole('button', { name: '预览兑换' }))
    await user.click(screen.getByRole('button', { name: '确认兑换' }))
    await within(screen.getByRole('dialog')).findByRole('button', { name: '查询回执' })
    vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(false)
    view.rerender()
    await user.click(screen.getByRole('button', { name: '关闭对话框' }))
    const card = screen.getByRole('region', { name: '资产兑换' })
    expect(within(card).getByRole('link', { name: /已提交交易/ })).toHaveAttribute('href', `https://www.oklink.com/xlayer/tx/${hash}`)
    await user.click(within(card).getByRole('button', { name: '查询回执' }))
    await within(card).findByText('交易已确认')
    expect(within(card).getByRole('button', { name: '公开兑换已暂停' })).toBeDisabled()
    expect(requests.filter((m) => m === 'eth_sendTransaction')).toHaveLength(1)
  })
  it.each([
    { locale: 'zh-CN', paused: '公开兑换已暂停', pay: '你将支付', pools: '流动性', receive: '你将收到', note: '公开兑换暂停期间仍可查看报价。' },
    { locale: 'en', paused: 'Public swaps paused', pay: 'You pay', pools: 'Liquidity', receive: 'You receive', note: 'Quotes remain available while public swaps are paused.' },
    { locale: 'yue-HK', paused: '公開兌換已暫停', pay: '你會支付', pools: '流動性', receive: '你會收到', note: '公開兌換暫停期間仍可睇報價。' },
  ])('shows read-only quotes but pauses new trades in $locale', async ({ locale, paused, pay, pools, receive, note }) => {
    vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(false)
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale }))
    const user = userEvent.setup()
    renderApp()
    await user.type(await screen.findByLabelText(pay), '1')
    await waitFor(() => expect(screen.getByLabelText(receive)).toHaveValue('1.000001'))
    expect(screen.getByText(note)).toBeVisible()
    expect(requests).toHaveLength(0)
    await connect(locale)
    expect(screen.getByRole('button', { name: paused })).toBeDisabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(POOLS.ready).toBe(true)
    await user.click(screen.getByRole('button', { name: pools }))
    const poolPage = await screen.findByRole('region', { name: locale === 'en' ? 'Put your assets in motion.' : locale === 'yue-HK' ? '畀資產，為流動出一分力。' : '让资产，为流动出一份力。' })
    expect(within(poolPage).getByText('V3 · 0.01%')).toBeVisible()
    expect(within(poolPage).getByText('V4 · 0%')).toBeVisible()
    expect(requests).not.toContain('eth_sendTransaction')
    const requestsSent = vi.mocked(fetch).mock.calls.map(([, options]) => options?.body ? JSON.parse(String(options.body)) as { method: string } : { method: 'rest' })
    expect(requestsSent.some(({ method }) => method === 'eth_call')).toBe(true)
    expect(requestsSent.some(({ method }) => method === 'eth_estimateGas')).toBe(false)
  })

  it('disables an existing review when public trading pauses before final confirmation', async () => {
    const user = userEvent.setup()
    const view = renderApp()
    await connect()
    await user.type(await screen.findByLabelText('你将支付'), '0.0001')
    await user.click(await screen.findByRole('button', { name: '预览兑换' }))
    vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(false)
    view.rerender()
    expect(screen.getByRole('dialog', { name: '预览兑换' })).toHaveTextContent('公开兑换暂停期间仍可查看报价。')
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: '确认兑换' })).toBeDisabled()
    expect(requests).not.toContain('eth_sendTransaction')
  })
  it('shows an actual quote and reviewed minimum, then only sends after the final consent and refreshes balances', async () => {
    const user = userEvent.setup()
    renderApp()
    await connect()
    const card = await screen.findByRole('region', { name: '资产兑换' })
    await user.type(within(card).getByLabelText('你将支付'), '0.0001')
    await waitFor(() => expect(within(card).getByRole('button', { name: '预览兑换' })).toBeEnabled())
    expect(within(card).getByLabelText('你将收到')).toHaveValue('1.000001')
    await user.click(within(card).getByRole('button', { name: '预览兑换' }))
    const dialog = screen.getByRole('dialog', { name: '预览兑换' })
    expect(within(dialog).getByText('0.995001 USD₮0')).toBeVisible()
    expect(requests.filter((m) => m === 'eth_sendTransaction')).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: '确认兑换' }))
    await within(dialog).findByText('兑换已确认，余额已刷新')
    expect(requests.filter((m) => m === 'eth_sendTransaction')).toHaveLength(1)
    const provider = (window as Window & { ethereum?: Eip1193Provider }).ethereum!
    expect(provider.request).toHaveBeenCalledWith({ method: 'eth_sendTransaction', params: [expect.objectContaining({ from: owner, to: CONTRACTS.router, chainId: '0xc4', gas: '0x186a0' })] })
    expect(within(dialog).getByRole('link', { name: /已提交交易/ })).toHaveAttribute(
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
        const request = options?.body ? JSON.parse(String(options.body)) as { method: string } : { method: 'rest' }
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
    const card = await screen.findByRole('region', { name: '资产兑换' })
    await user.type(within(card).getByLabelText('你将支付'), '0.0001')
    await waitFor(() => expect(within(card).getByRole('button', { name: '预览兑换' })).toBeEnabled())
    await user.click(within(card).getByRole('button', { name: '预览兑换' }))
    await user.click(screen.getByRole('button', { name: '确认兑换' }))
    await waitFor(() => expect(resolveReceipt).toBeTypeOf('function'))
    await user.click(screen.getByRole('button', { name: '关闭对话框' }))
    expect(within(card).getByRole('link', { name: /已提交交易/ })).toHaveAttribute(
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
    expect(within(card).getByRole('link', { name: /已提交交易/ })).toHaveAttribute(
      'href',
      `https://www.oklink.com/xlayer/tx/${hash}`,
    )
    expect(requests.filter((m) => m === 'eth_sendTransaction')).toHaveLength(1)
  })

  it('invalidates the final confirmation if the connected account changes after review', async () => {
    const user = userEvent.setup()
    renderApp()
    await connect()
    await user.type(await screen.findByLabelText('你将支付'), '0.0001')
    await waitFor(() => expect(screen.getByRole('button', { name: '预览兑换' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '预览兑换' }))
    act(() => listener?.(['0x2222222222222222222222222222222222222222']))
    expect(screen.getByRole('button', { name: '确认兑换' })).toBeDisabled()
    expect(screen.getByRole('dialog', { name: '预览兑换' })).toHaveTextContent('表单或钱包已变化，请重新预览当前报价。')
    expect(requests.filter((m) => m === 'eth_sendTransaction')).toHaveLength(0)
  })
  it('validates stablecoin precision and exposes actual pool search instead of a decorative empty state', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: '切换支付与接收资产' }))
    await user.type(await screen.findByLabelText('你将支付'), '1.0000001')
    expect(screen.getByRole('alert')).toHaveTextContent('最多支持 6 位小数')
    await user.click(screen.getByRole('button', { name: '搜索' }))
    await user.click(screen.getByRole('button', { name: '流动池' }))
    await user.click(screen.getByRole('button', { name: /SodaDEX · V4/ }))
    expect(await screen.findByText('V4 · 0%')).toBeVisible()
    expect(requests).toHaveLength(0)
  })
  it.each([
    { locale: 'en', pay: 'You pay', review: 'Review swap', confirm: 'Confirm swap', minimum: 'Minimum received' },
    { locale: 'yue-HK', pay: '你會支付', review: '預覽兌換', confirm: '確認兌換', minimum: '最少收到' },
  ])('localizes real trading review in $locale', async ({ locale, pay, review, confirm, minimum }) => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale, theme: 'light', currency: 'CNY' }))
    const user = userEvent.setup()
    renderApp()
    await connect(locale)
    await user.type(screen.getByLabelText(pay), '0.0001')
    await waitFor(() => expect(screen.getByRole('button', { name: review })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: review }))
    expect(screen.getByRole('dialog', { name: review })).toHaveTextContent(minimum)
    expect(screen.getByRole('button', { name: confirm })).toBeEnabled()
    expect(requests).not.toContain('eth_sendTransaction')
  })
})
