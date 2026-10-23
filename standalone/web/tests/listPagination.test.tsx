import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'
import { BalanceTable } from '../src/features/portfolio/BalanceTable'
import { PortfolioPositions } from '../src/features/portfolio/PortfolioPositions'
import { TradeMarketTrades } from '../src/features/market/TradeMarketTrades'
import { marketContext } from '../src/features/trade/context'
import { OrderList } from '../src/features/orders/OrderList'
import { useLimitOperation } from '../src/features/orders/useLimitOperation'
import * as orders from '../src/features/orders/api'
import { draftOrder } from '../src/features/orders/model'
import { KNOWN_CURRENCIES } from '../src/liquidity/config'
import type { LiquidityPosition } from '../src/liquidity/types'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { PREFERENCES_KEY } from '../src/preferences/model'
import { CurrencyPicker } from '../src/features/swap/CurrencyPicker'
import * as referenceCurrencies from '../src/features/swap/referenceTokens'
import { chartFixture, marketV3, marketOwner } from './tradeMarketFixture'
import { orderDeployment, orderUiFixture } from './ordersUiFixture'

function mount(tree: () => ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const element = (): ReactElement => <QueryClientProvider client={client}><PreferencesProvider>{tree()}</PreferencesProvider></QueryClientProvider>
  const view = render(element())
  return { rerender: () => view.rerender(element()) }
}
beforeEach(() => localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale: 'en', theme: 'light' })))
describe('ten-row business lists', () => {
  it('pages the combined local and reference currency picker and resets after searching', async () => {
    const local = Array.from({ length: 12 }, (_, i) => ({ ...KNOWN_CURRENCIES[2], address: `0x${(i + 1).toString(16).padStart(40, '0')}` as Address, symbol: `LOCAL${i}` }))
    const reference = Array.from({ length: 11 }, (_, i) => ({ ...KNOWN_CURRENCIES[2], address: `0x${(i + 100).toString(16).padStart(40, '0')}` as Address, symbol: `REFERENCE${i}` }))
    vi.spyOn(referenceCurrencies, 'referenceTokens').mockResolvedValue(reference)
    const onSelect = vi.fn(), user = userEvent.setup()
    mount(() => <CurrencyPicker currencies={local} selected={local[0]} onSelect={onSelect} onClose={vi.fn()} />)
    await screen.findByText('1–10 of 23')
    expect(document.querySelectorAll('.asset-option')).toHaveLength(10)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(document.querySelectorAll('.asset-option')).toHaveLength(10)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(document.querySelectorAll('.asset-option')).toHaveLength(3)
    await user.type(screen.getByRole('textbox'), 'LOCAL0')
    expect(document.querySelectorAll('.asset-option')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: /LOCAL0/ }))
    expect(onSelect).toHaveBeenCalledWith(local[0])
  })
  it('keeps all chart trades reachable instead of truncating the oldest entries', async () => {
    const fixture = chartFixture(), data = { ...fixture, trades: Array.from({ length: 23 }, (_, i) => ({ ...fixture.trades[0], id: `trade-${i}`, timestamp: 1700000100 + i })) }
    const context = marketContext({ from: marketV3.currency0, to: marketV3.currency1, protocol: 'v3', pools: [marketV3], loading: false, failed: false })
    mount(() => <TradeMarketTrades data={data} context={context} />)
    const user = userEvent.setup()
    expect(screen.getAllByRole('row')).toHaveLength(11)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getAllByRole('row')).toHaveLength(11)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getAllByRole('row')).toHaveLength(4)
    expect(screen.getByText(new Date(1700000100 * 1000).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))).toBeVisible()
  })
  it('locates a selected asset on its page and sends the exact row the user clicks', async () => {
    const tokens = Array.from({ length: 22 }, (_, i) => ({ currency: { ...KNOWN_CURRENCIES[2], address: `0x${(i + 1).toString(16).padStart(40, '0')}` as Address, symbol: `TOKEN${i}`, name: `Token ${i}` }, balance: 10n }))
    tokens.push({ currency: KNOWN_CURRENCIES[0], balance: 20n })
    const onSend = vi.fn(), user = userEvent.setup()
    mount(() => <BalanceTable tokens={tokens} selected={{ id: 'okb' }} onSend={onSend} />)
    const native = await screen.findByRole('group', { name: 'OKB' })
    expect(native).toHaveFocus()
    expect(screen.getAllByRole('group')).toHaveLength(3)
    await user.click(within(native).getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledWith(tokens[22])
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(screen.getAllByRole('group')).toHaveLength(10)
    expect(screen.queryByRole('group', { name: 'OKB' })).not.toBeInTheDocument()
  })
  it('pages portfolio NFTs while preserving the selected management action', async () => {
    const positions: LiquidityPosition[] = Array.from({ length: 23 }, (_, i) => ({ protocol: 'v3', tokenId: BigInt(i + 1), owner: marketOwner,
      pool: marketV3, tickLower: -10, tickUpper: 10, liquidity: 1n, amount0: 1n, amount1: 1n, claimable0: 0n, claimable1: 0n, fees0: 0n, fees1: 0n, inRange: true }))
    const onManage = vi.fn(), user = userEvent.setup()
    mount(() => <PortfolioPositions positions={positions} onManage={onManage} />)
    expect(screen.getAllByRole('article')).toHaveLength(10)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getAllByRole('article')).toHaveLength(3)
    await user.click(within(screen.getAllByRole('article')[2]).getByRole('button'))
    expect(onManage).toHaveBeenCalledOnce()
    expect(screen.getByText('V3 #23')).toBeVisible()
  })
  it('pages accumulated server orders and resets to the next wallet without signing', async () => {
    const f = orderUiFixture(), [native, wrapped, stable] = KNOWN_CURRENCIES
    const entries = Array.from({ length: 23 }, (_, i) => f.record(draftOrder({ from: wrapped, to: stable, pool: marketV3,
      amount: '0.01', minimum: '1', expiry: '2035-01-01T12:00:00Z' }, orderDeployment, marketOwner, String(i + 1), 100n)))
    const list = vi.spyOn(orders, 'listOrders').mockResolvedValueOnce({ orders: entries.slice(0, 13), nextCursor: 'next' })
      .mockResolvedValueOnce({ orders: entries.slice(13), nextCursor: null }).mockResolvedValue({ orders: [], nextCursor: null })
    function Orders(): ReactElement {
      const operation = useLimitOperation(f.wallet, orderDeployment, true)
      return <OrderList wallet={f.wallet} deployment={orderDeployment} ready operation={operation} currencies={[native, wrapped, stable]} />
    }
    const view = mount(() => <Orders />), user = userEvent.setup()
    await screen.findByRole('button', { name: 'Next' })
    expect(screen.getAllByRole('article')).toHaveLength(10)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getAllByRole('article')).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'More orders' }))
    await waitFor(() => expect(list).toHaveBeenCalledWith(marketOwner, orderDeployment, 'next'))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(10))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getAllByRole('article')).toHaveLength(3)
    f.change(); view.rerender()
    await screen.findByText('No orders returned for this wallet.')
    expect(screen.queryAllByRole('article')).toHaveLength(0)
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument()
    expect(f.methods).toEqual([])
  })
})
