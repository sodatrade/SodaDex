import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { GeneralSwapCard } from '../src/features/swap/GeneralSwapCard'
import { LiquidityPage } from '../src/features/liquidity/LiquidityPage'
import { CurrencyConfiguration } from '../src/features/liquidity/CurrencyConfiguration'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { liquidityText } from '../src/i18n/liquidity'
import * as liquidity from '../src/liquidity'
import * as trades from '../src/trading/poolTrade'
import * as v2 from '../src/liquidity/v2Pools'
import type { LiquidityPool } from '../src/liquidity/types'
import type { WalletController } from '../src/lib/useWallet'
const wallet = { session: undefined, getIdentity: () => undefined } as WalletController
const pool: LiquidityPool = { protocol: 'v3', id: '0x1111111111111111111111111111111111111111', currency0: liquidity.KNOWN_CURRENCIES[1], currency1: liquidity.KNOWN_CURRENCIES[2], fee: 100, tickSpacing: 1, sqrtPriceX96: 2n ** 96n, tick: 0, liquidity: 1000n, initialized: true }
const hidden: LiquidityPool = { ...pool, protocol: 'v4', id: `0x${'a'.repeat(64)}` }
function mount(child: React.ReactNode): void {
 render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><PreferencesProvider>{child}</PreferencesProvider></QueryClientProvider>)
}
afterEach(() => vi.restoreAllMocks())
it('never quotes hidden V4 pools in Auto, and removes V4 from settings', async () => {
 vi.spyOn(liquidity, 'listAllPools').mockResolvedValue([pool, hidden])
 const quote = vi.spyOn(trades, 'getPoolTradeQuote').mockImplementation(async (p, zeroForOne, amount) => ({ pool: p, zeroForOne, amount, amountOut: 1000n, minimumOut: 995n, slippageBps: 50 }))
 mount(<GeneralSwapCard wallet={wallet} balances={undefined} balancesLoading={false} balancesError={false} onConnect={vi.fn()} />)
 await userEvent.type(screen.getByLabelText('你将支付'), '0.001')
 await waitFor(() => expect(quote).toHaveBeenCalled())
 expect(quote.mock.calls.every(([p]) => p.protocol === 'v3')).toBe(true)
 await userEvent.click(screen.getByRole('button', { name: '兑换设置' }))
 expect(screen.getByRole('radio', { name: 'V2' })).toBeVisible()
 expect(screen.getByRole('radio', { name: 'V3' })).toBeVisible()
 expect(screen.queryByRole('radio', { name: 'V4' })).not.toBeInTheDocument()
 expect(screen.getByRole('dialog').textContent).not.toContain('V4')
})
it('filters V4 from the pool list', async () => {
 vi.spyOn(liquidity, 'listAllPools').mockResolvedValue([pool, hidden])
 vi.spyOn(v2, 'listV2Positions').mockResolvedValue({ positions: [], unavailable: 0 })
 mount(<LiquidityPage wallet={wallet} onConnect={vi.fn()} />)
 await screen.findByText(/V3 ·/)
 expect(screen.queryByText(/V4 ·/)).not.toBeInTheDocument()
})
it('offers only V2 and V3 for new pools', () => {
 mount(<CurrencyConfiguration l={liquidityText('zh-CN')} disabled={false} onPool={vi.fn()} />)
 expect(screen.queryByText('V4')).not.toBeInTheDocument()
 expect(screen.getByText('V2')).toBeVisible()
 expect(screen.getByText('V3')).toBeVisible()
})

it('does not query or display V4 positions during discovery', async () => {
 vi.spyOn(liquidity, 'listAllPools').mockResolvedValue([])
 vi.spyOn(v2, 'listV2Positions').mockResolvedValue({ positions: [], unavailable: 0 })
 const positions = vi.spyOn(liquidity, 'listPositions').mockResolvedValue([])
 const connected = { ...wallet, session: { address: '0x1111111111111111111111111111111111111111', chainId: 196, id: 'test', name: 'Test', provider: { request: vi.fn() } } } as WalletController
 mount(<LiquidityPage wallet={connected} onConnect={vi.fn()} />)
 await userEvent.click(screen.getByRole('button', { name: '我的仓位' }))
 await waitFor(() => expect(positions).toHaveBeenCalled())
 expect(positions.mock.calls.every(([, , protocol]) => protocol === 'v3')).toBe(true)
 expect(screen.queryByText(/V4/)).not.toBeInTheDocument()
})
