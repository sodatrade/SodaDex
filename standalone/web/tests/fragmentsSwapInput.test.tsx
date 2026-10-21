import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseEther } from 'viem'
import { SwapScreen } from '../src/fragments/SwapScreen'
import { messages } from '../src/fragments/messages'
import type { ScreenProps } from '../src/fragments/types'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { PREFERENCES_KEY } from '../src/preferences/model'

const address = '0x1111111111111111111111111111111111111111'
function mount(account: ScreenProps['account'] = address) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const readContract = vi.fn().mockResolvedValue([parseEther('0.1'), 0n, 0n])
  const prepare = vi.fn(), onConnect = vi.fn()
  const props = {
    client: { readContract } as unknown as ScreenProps['client'], account, m: messages('en'), prepare,
    deployment: { vault: address, pool: address, policy: address, chainId: 196, fromBlock: 0n, rpcUrl: 'http://fixture.invalid' },
    snapshot: { okb: parseEther('10'), shares: parseEther('100'), lpSupply: 1n, rewards: address,
      preciseLiquidity: true, okbBalance: parseEther('2'), shareBalance: parseEther('1250.123456789'), lpBalance: 0n },
  } satisfies ScreenProps
  const tree = (overrides: Partial<ScreenProps> = {}) => <QueryClientProvider client={client}><PreferencesProvider><SwapScreen {...props} {...overrides} onConnect={onConnect} /></PreferencesProvider></QueryClientProvider>
  const view = render(tree())
  return { props, prepare, readContract, onConnect, rerender: (overrides: Partial<ScreenProps>) => view.rerender(tree(overrides)) }
}
beforeEach(() => localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale: 'en', theme: 'light', currency: 'USD' })))

describe('miner share swap balances', () => {
  it('shows both wallet balances before entry and swaps them with the currencies', () => {
    mount()
    const pay = screen.getByLabelText('You pay').closest('.amount-panel')!
    expect(within(pay as HTMLElement).getByText('Balance 2')).toBeVisible()
    expect(screen.getByTitle('1250.123456789 sFAB')).toHaveTextContent('Balance 1250.123456')
    fireEvent.click(screen.getByRole('button', { name: 'Reverse direction' }))
    expect(within(pay as HTMLElement).getByText('Balance 1250.123456')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Max' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Max' }))
    expect(screen.getByLabelText('You pay')).toHaveValue('1250.123456789')
    expect(screen.getByLabelText('You receive')).toHaveAttribute('readonly')
  })
  it('blocks an OKB input exceeding the exact balance by one wei before quoting or preparing', () => {
    const view = mount()
    fireEvent.change(screen.getByLabelText('You pay'), { target: { value: '2.000000000000000001' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Insufficient balance')
    expect(screen.getByRole('button', { name: 'Insufficient balance' })).toBeDisabled()
    expect(screen.getByLabelText('You pay')).toHaveAttribute('aria-invalid', 'true')
    expect(view.readContract).not.toHaveBeenCalled()
    expect(view.prepare).not.toHaveBeenCalled()
  })
  it('checks sFAB on sells and reacts to refreshed wallet balances', async () => {
    const view = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Reverse direction' }))
    fireEvent.change(screen.getByLabelText('You pay'), { target: { value: '1251' } })
    expect(screen.getByRole('button', { name: 'Insufficient balance' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('You pay'), { target: { value: '1' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview transaction' })).toBeEnabled())
    view.rerender({ snapshot: { ...view.props.snapshot, shareBalance: parseEther('0.5') } })
    expect(screen.getByRole('button', { name: 'Insufficient balance' })).toBeDisabled()
    expect(view.prepare).not.toHaveBeenCalled()
  })
  it('shows unknown balances while disconnected and keeps the connect action available', () => {
    const view = mount(undefined)
    // Explicit override avoids the helper's default account.
    view.rerender({ account: undefined })
    expect(screen.getAllByText('Balance —')).toHaveLength(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connect wallet' }))
    expect(view.onConnect).toHaveBeenCalledOnce()
  })
})
