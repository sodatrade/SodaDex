import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TradeDetails } from '../src/features/swap/TradeDetails'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { PREFERENCES_KEY } from '../src/preferences/model'
import type { PoolTradeQuote } from '../src/trading/poolTrade'
import { marketV3, marketV4 } from './tradeMarketFixture'

function mount(fee: number): void {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale: 'en' }))
  const quote: PoolTradeQuote = { pool: { ...marketV4, currency0: marketV3.currency0, currency1: marketV3.currency1, fee }, zeroForOne: true, amount: 10n, amountOut: 35253640811n, minimumOut: 35077372607n, slippageBps: 50 }
  render(<PreferencesProvider><TradeDetails quote={quote} /></PreferencesProvider>)
}

describe('pool fee disclosure', () => {
  it('does not misrepresent rounded multi-step fees as zero for tiny input', () => {
    mount(100)
    expect(screen.getByText('V4 · 0.01%')).toBeVisible()
    expect(screen.getByText('Included in quote; actual fees use on-chain rounding.')).toBeVisible()
    expect(screen.queryByText('0 USD₮0')).not.toBeInTheDocument()
  })
  it('still identifies a zero fee pool explicitly', () => {
    mount(0)
    expect(screen.getByText('0 USD₮0')).toBeVisible()
    expect(screen.queryByText('Included in quote; actual fees use on-chain rounding.')).not.toBeInTheDocument()
  })
})
