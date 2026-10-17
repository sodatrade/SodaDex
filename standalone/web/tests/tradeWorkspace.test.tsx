import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TradeWorkspace } from '../src/features/trade/TradeWorkspace'
import { marketContext, type TradeMarketContext } from '../src/features/trade/context'
import { KNOWN_CURRENCIES } from '../src/liquidity/config'
import * as api from '../src/features/market/api'
import * as liquidity from '../src/liquidity'
import type { WalletController } from '../src/lib/useWallet'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { PREFERENCES_KEY } from '../src/preferences/model'
import * as trades from '../src/trading/poolTrade'
import { chartFixture, marketHash, marketOwner, marketV3, marketV4 } from './tradeMarketFixture'
let client: QueryClient, wallet: WalletController
function mount(element?: React.ReactNode): ReturnType<typeof render> {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}><PreferencesProvider>{element ?? <TradeWorkspace wallet={wallet} balances={{ okb: 10n ** 18n, wokb: 0n, usdt0: 1000000n }} balancesLoading={false} balancesError={false} onConnect={vi.fn()} />}</PreferencesProvider></QueryClientProvider>)
}
beforeEach(() => {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale: 'en', theme: 'light', currency: 'USD' }))
  const identity = { address: marketOwner as `0x${string}`, chainId: 196, revision: 1, provider: { request: vi.fn(async () => undefined) } }
  wallet = { session: { ...identity, id: 'readonly', name: 'Read only' }, getIdentity: () => identity,
    status: 'idle', options: [], connect: vi.fn(), switchChain: vi.fn(), disconnect: vi.fn(), error: undefined }
  vi.spyOn(liquidity, 'listPools').mockResolvedValue([marketV3, marketV4])
  vi.spyOn(trades, 'getPoolTradeQuote').mockImplementation(async (pool, zeroForOne, amount, slippageBps = 50) => ({ pool, zeroForOne, amount, amountOut: pool.protocol === 'v4' ? 200n : 100n, minimumOut: 99n, slippageBps }))
  vi.spyOn(trades, 'executePoolTrade').mockRejectedValue(Error('Market test must never execute'))
  vi.spyOn(api, 'getChart').mockImplementation(async (pool, query) => chartFixture(pool.protocol === 'v3' ? marketV3 : marketV4, { interval: query.interval }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 1, chainId: 196, source: 'uniswap', readOnly: true, tokens: [] }))))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('same-screen market and swap', () => {
  it('reads the pair market with no amount, quote request or wallet request', async () => {
    mount(); expect(await screen.findByText('1 OKB = 125 USD₮0')).toBeInTheDocument()
    expect(screen.getByText(/Pair pool · before a route quote/)).toBeInTheDocument()
    expect(screen.getByText(/Pool snapshot ·/)).toBeVisible()
    expect(trades.getPoolTradeQuote).not.toHaveBeenCalled(); expect(wallet.session?.provider.request).not.toHaveBeenCalled()
  })
  it('switches to the actual Auto quote pool and reverses chart units with the swap', async () => {
    mount(); await screen.findByText('1 OKB = 125 USD₮0')
    await userEvent.type(screen.getByLabelText('You pay'), '0.000001')
    expect(await screen.findByText('1 OKB = 200 USD₮0')).toBeInTheDocument()
    expect(screen.getByText(/Current quoted route · V4/)).toBeInTheDocument()
    expect(api.getChart).toHaveBeenCalledWith(expect.objectContaining({ id: marketV4.id }), expect.objectContaining({ interval: '5m' }))
    await userEvent.click(screen.getByRole('button', { name: 'Switch pay and receive assets' }))
    expect(await screen.findByText('1 USD₮0 = 0.008 OKB')).toBeInTheDocument()
    expect(wallet.session?.provider.request).not.toHaveBeenCalled(); expect(trades.executePoolTrade).not.toHaveBeenCalled()
  })
  it('updates market asset labels and stops pool charts for native wrapping', async () => {
    mount(); await screen.findByText('1 OKB = 125 USD₮0')
    await userEvent.click(screen.getByRole('button', { name: /Choose receive asset/ }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /WOKB/ }))
    expect(await screen.findByText('OKB / WOKB converts 1:1. No pool chart is used.')).toBeInTheDocument()
    expect(screen.queryByText('1 OKB = 125 USD₮0')).not.toBeInTheDocument()
  })
  it('keeps swap input and reviewed order unchanged while chart intervals change', async () => {
    mount(); await userEvent.type(screen.getByLabelText('You pay'), '0.000001')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review swap' })).toBeEnabled())
    const input = screen.getByLabelText('You pay')
    await userEvent.click(screen.getByRole('button', { name: '1h' }))
    expect(screen.getByLabelText('You pay')).toBe(input); expect(input).toHaveValue('0.000001')
    await userEvent.click(screen.getByRole('button', { name: 'Review swap' }))
    expect(within(screen.getByRole('dialog')).getByText('0.000099 USD₮0')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '1d' }))
    expect(within(screen.getByRole('dialog')).getByText('0.000099 USD₮0')).toBeInTheDocument()
    expect(trades.executePoolTrade).not.toHaveBeenCalled()
  })
  it('hides old prices and chart points after a request failure, then restarts cleanly', async () => {
    mount(); await screen.findByText('1 OKB = 125 USD₮0')
    vi.mocked(api.getChart).mockRejectedValue(Error('RPC unavailable'))
    await act(async () => { await client.invalidateQueries({ queryKey: ['trade-chart'] }) })
    const region = screen.getByRole('region', { name: 'Pair market' })
    expect(await within(region).findByRole('alert')).toHaveTextContent('Market data unavailable.')
    expect(screen.queryByText('1 OKB = 125 USD₮0')).not.toBeInTheDocument(); expect(within(region).queryByRole('img')).not.toBeInTheDocument()
    vi.mocked(api.getChart).mockImplementation(async () => chartFixture())
    await userEvent.click(within(region).getAllByRole('button', { name: 'Retry' }).at(-1)!)
    expect(await screen.findByText('1 OKB = 125 USD₮0')).toBeInTheDocument()
    expect(wallet.session?.provider.request).not.toHaveBeenCalled()
  })
  it('replaces cumulative pages rather than double counting prior swaps', async () => {
    const partial = chartFixture(marketV3, { queryComplete: false, nextCursor: 'page-2', coverage: { fromBlock: 73361037, toBlock: 73363036, complete: false, nextFromBlock: 73363037 } })
    const next = chartFixture(marketV3, { candles: [...partial.candles, { ...partial.candles[0], time: 1700000700, bucketEndTime: 1700001000 }],
      trades: [...partial.trades, { ...partial.trades[0], id: `${marketHash}:1`, logIndex: 1, timestamp: 1700000701 }] })
    vi.mocked(api.getChart).mockResolvedValueOnce(partial).mockResolvedValueOnce(next)
    mount()
    await screen.findByText(/Requested range scanned/)
    expect(screen.getAllByRole('row')).toHaveLength(3)
    expect(api.getChart).toHaveBeenLastCalledWith(expect.anything(), { interval: '5m', cursor: 'page-2' })
  })
  it('automatically scans to historical swaps and lets the user pause further requests', async () => {
    const partial = chartFixture(marketV3, { queryComplete: false, nextCursor: 'page-2' })
    let finish!: (value: api.ChartResponse) => void
    vi.mocked(api.getChart).mockResolvedValueOnce(partial).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValueOnce(chartFixture())
    mount(); await waitFor(() => expect(api.getChart).toHaveBeenCalledTimes(2))
    await userEvent.click(screen.getByRole('button', { name: 'Pause scan' }))
    await act(async () => { finish({ ...partial, nextCursor: 'page-3' }) })
    expect(api.getChart).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByRole('button', { name: 'Resume scan' }))
    await screen.findByText(/Requested range scanned/)
    expect(api.getChart).toHaveBeenLastCalledWith(expect.anything(), { interval: '5m', cursor: 'page-3' })
    expect(wallet.session?.provider.request).not.toHaveBeenCalled()
  })

  it('preserves the mounted swap form while a real order panel occupies the slot', async () => {
    const props = { wallet, balances: { okb: 10n ** 18n, wokb: 0n, usdt0: 1000000n }, balancesLoading: false, balancesError: false, onConnect: vi.fn() }
    const panel = vi.fn((context: TradeMarketContext) => <section aria-label="Real order panel">{context.from.symbol}/{context.to.symbol}</section>)
    const view = mount(<TradeWorkspace {...props} renderOrderPanel={panel} />)
    const input = screen.getByLabelText('You pay')
    await userEvent.type(input, '0.000001'); await screen.findByText('1 OKB = 200 USD₮0')
    const tree = (mode: 'swap' | 'limit') => <QueryClientProvider client={client}><PreferencesProvider><TradeWorkspace {...props} activeMode={mode} renderOrderPanel={panel} /></PreferencesProvider></QueryClientProvider>
    view.rerender(tree('limit'))
    expect(screen.getByRole('region', { name: 'Real order panel' })).toHaveTextContent('OKB/USD₮0')
    expect(input).not.toBeVisible(); expect(input).toHaveValue('0.000001')
    view.rerender(tree('swap'))
    expect(screen.getByLabelText('You pay')).toBe(input); expect(input).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Real order panel' })).not.toBeInTheDocument()
    expect(trades.executePoolTrade).not.toHaveBeenCalled()
  })

  it.each([
    ['zh-CN', '交易对行情', '蜡烛图'], ['en', 'Pair market', 'Candles'], ['yue-HK', '交易對行情', '蠟燭圖'],
  ])('renders the synchronized market controls in %s', async (locale, regionName, candleName) => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale, theme: 'light' }))
    mount(); const region = screen.getByRole('region', { name: regionName })
    expect(await within(region).findByText('1 OKB = 125 USD₮0')).toBeInTheDocument()
    await userEvent.click(within(region).getByRole('button', { name: candleName }))
    expect(within(region).getByRole('img')).toHaveAccessibleName(new RegExp(candleName))
    expect(wallet.session?.provider.request).not.toHaveBeenCalled()
  })
  it('clears an expired cumulative scan and retries from the first page', async () => {
    const partial = chartFixture(marketV3, { queryComplete: false, nextCursor: 'expired', coverage: { fromBlock: 73361037, toBlock: 73363036, complete: false, nextFromBlock: 73363037 } })
    vi.mocked(api.getChart).mockResolvedValueOnce(partial).mockRejectedValueOnce(new api.DataError('CURSOR_EXPIRED')).mockResolvedValue(chartFixture())
    mount()
    const region = screen.getByRole('region', { name: 'Pair market' })
    expect(await within(region).findByRole('alert')).toHaveTextContent('The scan changed or expired.')
    expect(within(region).queryByRole('img')).not.toBeInTheDocument(); expect(screen.queryByText('1 OKB = 125 USD₮0')).not.toBeInTheDocument()
    await userEvent.click(within(region).getAllByRole('button', { name: 'Retry' }).at(-1)!)
    expect(await screen.findByText('1 OKB = 125 USD₮0')).toBeInTheDocument()
    expect(api.getChart).toHaveBeenLastCalledWith(expect.anything(), { interval: '5m' })
  })

  it('uses the real order panel pair independently from the preserved swap form', async () => {
    const orderMarketContext = marketContext({ from: KNOWN_CURRENCIES[1], to: KNOWN_CURRENCIES[2], protocol: 'v3', pools: [marketV3], loading: false, failed: false })
    mount(<TradeWorkspace wallet={wallet} balances={undefined} balancesLoading={false} balancesError={false} onConnect={vi.fn()} activeMode="limit" orderMarketContext={orderMarketContext} />)
    expect(await screen.findByText('1 WOKB = 125 USD₮0')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'WOKB / USD₮0' })).toBeInTheDocument()
    expect(screen.getByLabelText('You pay')).not.toBeVisible()
    expect(trades.getPoolTradeQuote).not.toHaveBeenCalled(); expect(wallet.session?.provider.request).not.toHaveBeenCalled()
  })
  it('provides keyboard access to actual candle observations', async () => {
    const first = chartFixture().candles[0]
    vi.mocked(api.getChart).mockResolvedValue(chartFixture(marketV3, { candles: [first, { ...first, time: first.time + 600, bucketEndTime: first.bucketEndTime + 600, close: '0.01' }] }))
    mount(); const plot = await screen.findByRole('img')
    plot.focus(); await userEvent.keyboard('{Home}')
    expect(plot.parentElement?.parentElement?.querySelector('figcaption')).toHaveTextContent('Close 125')
    await userEvent.keyboard('{End}')
    expect(plot.parentElement?.parentElement?.querySelector('figcaption')).toHaveTextContent('Close 100')
  })
  it('renders an honest empty chart and a single real observation', async () => {
    vi.mocked(api.getChart).mockResolvedValue(chartFixture(marketV3, { candles: [], trades: [] }))
    mount(); const region = screen.getByRole('region', { name: 'Pair market' })
    expect(await within(region).findAllByText('No swaps observed in the scanned blocks.')).toHaveLength(2)
    expect(within(region).queryByRole('img')).not.toBeInTheDocument()
    vi.mocked(api.getChart).mockResolvedValue(chartFixture())
    await userEvent.click(within(region).getByRole('button', { name: 'Retry' }))
    const chart = await within(region).findByRole('img')
    expect(chart.querySelector('circle')).toHaveAttribute('cx', '360')
    expect(chart.querySelector('circle')).toHaveAttribute('cy', '130')
    await userEvent.click(within(region).getByRole('button', { name: 'Candles' }))
    expect((await within(region).findByRole('img')).querySelectorAll('[data-candle-time]')).toHaveLength(1)
  })
})
