import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeFunctionResult, type Hex } from 'viem'
import { PortfolioPage } from '../src/features/portfolio/PortfolioPage'
import { ReceiveDialog } from '../src/features/portfolio/ReceiveDialog'
import { SendDialog } from '../src/features/portfolio/SendDialog'
import { rememberToken } from '../src/domain/tokenCatalog'
import { readTransactions, recordTransaction } from '../src/features/history/journal'
import * as api from '../src/features/market/api'
import * as liquidity from '../src/liquidity'
import * as currencies from '../src/liquidity/currencies'
import { tokenAbi } from '../src/liquidity/abis'
import type { LiquidityPosition } from '../src/liquidity/types'
import * as rpc from '../src/lib/rpc'
import type { WalletController } from '../src/lib/useWallet'
import type { WalletIdentity } from '../src/lib/wallet'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { PREFERENCES_KEY } from '../src/preferences/model'
import * as transfers from '../src/trading/transfers'
import * as receipts from '../src/trading/receipts'
const owner = '0x1111111111111111111111111111111111111111', recipient = '0x2222222222222222222222222222222222222222'
const hash = `0x${'a'.repeat(64)}` as Hex
const [native, , stable] = liquidity.KNOWN_CURRENCIES
let identity: WalletIdentity, wallet: WalletController, client: QueryClient
const actions = { onConnect: vi.fn(), onSwap: vi.fn(), onPools: vi.fn(), onTabChange: vi.fn() }
const token = { currency: stable, balance: 1000000n }
function mount(tree: () => React.ReactNode) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const full = () => <QueryClientProvider client={client}><PreferencesProvider>{tree()}</PreferencesProvider></QueryClientProvider>
  const view = render(full()); return { rerender: () => view.rerender(full()) }
}
const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
beforeEach(() => {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale: 'en', theme: 'light', currency: 'USD' }))
  identity = { address: owner, chainId: 196, provider: { request: vi.fn(async () => undefined) }, revision: 1 }
  wallet = { options: [], session: { ...identity, id: 'mock', name: 'Mock' }, status: 'idle', error: undefined,
    getIdentity: () => identity, connect: vi.fn(), switchChain: vi.fn(), disconnect: vi.fn() }
  for (const action of Object.values(actions)) action.mockClear()
  vi.spyOn(rpc, 'rpc').mockImplementation(async (method) => {
    if (method === 'eth_chainId') return '0xc4'
    if (method === 'eth_getBalance') return '0xde0b6b3a7640000'
    if (method === 'eth_estimateGas') return '0x5208'
    if (method === 'eth_gasPrice') return '0x1'
    return encodeFunctionResult({ abi: tokenAbi, functionName: 'balanceOf', result: 1000000n })
  })
  vi.spyOn(liquidity, 'listPositions').mockResolvedValue([])
  vi.spyOn(transfers, 'executeTransfer').mockImplementation(async (_request, context) => {
    context.onProgress({ stage: 'tradeConfirming', hash, to: stable.address, kind: 'swap' })
    context.onProgress({ stage: 'tradeSucceeded', hash, kind: 'swap' }); return hash
  })
  vi.spyOn(api, 'getEvents').mockResolvedValue({ schemaVersion: 1, chainId: 196, asOf: { number: 123, hash, timestamp: 1 }, coverage: { fromBlock: 1, toBlock: 123, complete: true, nextFromBlock: null }, events: [], nextCursor: null })
})
afterEach(() => {
  vi.restoreAllMocks()
  if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
})
async function fillSend(): Promise<void> {
  await userEvent.type(screen.getByRole('textbox', { name: 'Recipient address' }), recipient)
  await userEvent.type(screen.getByRole('textbox', { name: 'Amount' }), '0.25')
  await userEvent.click(screen.getByRole('button', { name: 'Review send' }))
}
describe('portfolio tabs and real read states', () => {
  it('shows native units, real NFT count and pending browser records without fiat estimates', async () => {
    recordTransaction({ chainId: 196, hash, account: owner, to: recipient, kind: 'send', status: 'pending', submittedAt: Date.now() })
    mount(() => <PortfolioPage wallet={wallet} {...actions} />)
    await screen.findByText('1'); expect(screen.getByText('Native OKB balance')).toBeInTheDocument()
    expect(screen.getByText('Independent fiat values are unavailable. Balances use native token units.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Swap' })); expect(actions.onSwap).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Create position' })); expect(actions.onPools).toHaveBeenCalledOnce()
  })
  it('displays a failed token balance as unavailable rather than zero', async () => {
    const original = vi.mocked(rpc.rpc).getMockImplementation()!
    vi.mocked(rpc.rpc).mockImplementation(async (method, params) => {
      if (method === 'eth_call') throw Error('RPC unavailable')
      return original(method, params)
    })
    mount(() => <PortfolioPage wallet={wallet} {...actions} initialTab="tokens" />)
    await screen.findByText('Some balances could not be read and are shown as —.')
    expect(within(screen.getByRole('group', { name: 'USD₮0' })).getByText('—')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'USD₮0' })).getByRole('button', { name: 'Send' })).toBeDisabled()
  })
  it('revalidates imported addresses onchain before displaying balances', async () => {
    const address = '0x3333333333333333333333333333333333333333'
    rememberToken(address)
    vi.spyOn(currencies, 'importCurrency').mockResolvedValue({ address, symbol: 'IMPORTED', name: 'Imported token', decimals: 8, native: false })
    mount(() => <PortfolioPage wallet={wallet} {...actions} initialTab="tokens" />)
    await screen.findByRole('group', { name: 'IMPORTED' })
    expect(currencies.importCurrency).toHaveBeenCalledWith(address)
  })
  it('opens actual position NFTs and routes management to liquidity', async () => {
    const position = { protocol: 'v3', tokenId: 42n, owner, liquidity: 10n, amount0: 1n, amount1: 2n,
      pool: { protocol: 'v3', id: owner, address: owner, currency0: native, currency1: stable, fee: 100, tickSpacing: 1, sqrtPriceX96: 2n ** 96n, tick: 0, liquidity: 10n, initialized: true },
      tickLower: -100, tickUpper: 100, fees0: 0n, fees1: 0n, claimable0: 0n, claimable1: 0n, inRange: true } satisfies LiquidityPosition
    vi.mocked(liquidity.listPositions).mockResolvedValue([position])
    mount(() => <PortfolioPage wallet={wallet} {...actions} initialTab="nfts" />)
    const link = await screen.findByRole('link', { name: 'View NFT' })
    expect(link).toHaveAttribute('href', expect.stringContaining(`${liquidity.LP_CONTRACTS.v3Manager}/42`))
    await userEvent.click(screen.getByRole('button', { name: 'Manage position' })); expect(actions.onPools).toHaveBeenCalledOnce()
  })
  it('uses wallet/local activity filters and never requests whole-wallet external history', async () => {
    mount(() => <PortfolioPage wallet={wallet} {...actions} initialTab="activity" />)
    await waitFor(() => expect(api.getEvents).toHaveBeenCalledWith({ owner }))
    expect(screen.queryByRole('button', { name: 'All activity' })).not.toBeInTheDocument()
    expect(screen.getByText(/not full wallet history/)).toBeInTheDocument()
  })
  it('changes URL-facing tabs and responds to initialTab changes', async () => {
    let initial: 'overview' | 'nfts' = 'overview'
    const view = mount(() => <PortfolioPage wallet={wallet} {...actions} initialTab={initial} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Tokens' })); expect(actions.onTabChange).toHaveBeenCalledWith('tokens')
    initial = 'nfts'; view.rerender(); expect(screen.getByRole('tab', { name: 'Position NFTs' })).toHaveAttribute('aria-selected', 'true')
  })
  it.each([['zh-CN', '你的资产与仓位', '概览'], ['en', 'Your assets and positions', 'Overview'], ['yue-HK', '你嘅資產同倉位', '概覽']] as const)('supports the %s portfolio labels', async (locale, title, overview) => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale, theme: 'light', currency: 'USD' }))
    mount(() => <PortfolioPage wallet={wallet} {...actions} />)
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: overview })).toHaveAttribute('aria-selected', 'true')
  })
  it('does not query balances or NFTs on the wrong wallet network', async () => {
    identity = { ...identity, chainId: 1 }; wallet.session = { ...identity, id: 'mock', name: 'Mock' }
    mount(() => <PortfolioPage wallet={wallet} {...actions} />)
    await userEvent.click(screen.getByRole('button', { name: 'Switch to X Layer' }))
    expect(wallet.switchChain).toHaveBeenCalledOnce(); expect(rpc.rpc).not.toHaveBeenCalled(); expect(liquidity.listPositions).not.toHaveBeenCalled()
  })
})
describe('wallet transfer review and recovery', () => {
  it('previews exact ERC20 units and gas without a wallet request, then sends only on confirmation', async () => {
    mount(() => <SendDialog wallet={wallet} token={token} onClose={vi.fn()} />); await fillSend()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm in wallet' })).toBeEnabled())
    expect(screen.getByText('Estimated network fee')).toBeInTheDocument()
    expect(transfers.executeTransfer).not.toHaveBeenCalled(); expect(identity.provider.request).not.toHaveBeenCalled()
    const invalidation = vi.spyOn(client, 'invalidateQueries')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))
    expect(transfers.executeTransfer).toHaveBeenCalledWith({ currency: stable, recipient, amount: 250000n }, expect.objectContaining({ identity }))
    await screen.findByText('Transfer confirmed'); expect(readTransactions(owner)[0].status).toBe('success')
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['portfolio-tokens'] })
  })
  it('blocks confirmation when gas estimation fails and opens no wallet transaction', async () => {
    const original = vi.mocked(rpc.rpc).getMockImplementation()!
    vi.mocked(rpc.rpc).mockImplementation(async (method, params) => { if (method === 'eth_estimateGas') throw Error('No gas'); return original(method, params) })
    mount(() => <SendDialog wallet={wallet} token={token} onClose={vi.fn()} />); await fillSend()
    await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Confirm in wallet' })).toBeDisabled()
    expect(transfers.executeTransfer).not.toHaveBeenCalled(); expect(identity.provider.request).not.toHaveBeenCalled()
  })
  it('invalidates an unfinished form after the wallet account changes', async () => {
    const view = mount(() => <SendDialog wallet={wallet} token={token} onClose={vi.fn()} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Recipient address' }), recipient)
    await userEvent.type(screen.getByRole('textbox', { name: 'Amount' }), '0.25')
    identity = { ...identity, address: recipient, revision: 2 }; view.rerender()
    expect(screen.getByRole('button', { name: 'Review send' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Amount' })).toBeDisabled(); expect(transfers.executeTransfer).not.toHaveBeenCalled()
  })
  it('disables a reviewed send if the connected identity changes', async () => {
    const view = mount(() => <SendDialog wallet={wallet} token={token} onClose={vi.fn()} />); await fillSend()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm in wallet' })).toBeEnabled())
    identity = { ...identity, address: recipient, revision: 2 }; view.rerender()
    expect(screen.getByRole('button', { name: 'Confirm in wallet' })).toBeDisabled(); expect(transfers.executeTransfer).not.toHaveBeenCalled()
  })
  it('retains a broadcast hash on transport failure and only queries its receipt after an account switch', async () => {
    vi.mocked(transfers.executeTransfer).mockImplementation(async (_request, context) => { context.onProgress({ stage: 'tradeConfirming', hash, to: stable.address, kind: 'swap' }); throw Error('Disconnected') })
    const receipt = vi.spyOn(receipts, 'receiptStatus').mockRejectedValue(Error('RPC unavailable'))
    const view = mount(() => <SendDialog wallet={wallet} token={token} onClose={vi.fn()} />); await fillSend()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm in wallet' })).toBeEnabled()); await userEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))
    const link = await screen.findByRole('link', { name: 'View transaction' }); expect(link).toHaveAttribute('href', expect.stringContaining(hash))
    identity = { ...identity, address: recipient, revision: 2 }; view.rerender()
    await userEvent.click(screen.getByRole('button', { name: 'Refresh receipt' })); expect(readTransactions(owner)[0].status).toBe('pending')
    receipt.mockResolvedValue('success'); await userEvent.click(screen.getByRole('button', { name: 'Refresh receipt' }))
    await screen.findByText('Transfer confirmed'); expect(receipt).toHaveBeenLastCalledWith(rpc.rpc, hash, owner, stable.address)
    expect(transfers.executeTransfer).toHaveBeenCalledOnce()
  })
  it('restores a pending send without gas estimation, signing or automatic resend', async () => {
    recordTransaction({ chainId: 196, hash, account: owner, to: recipient, kind: 'send', status: 'pending', submittedAt: Date.now() })
    vi.spyOn(receipts, 'receiptStatus').mockResolvedValue('success')
    mount(() => <SendDialog wallet={wallet} token={token} onClose={vi.fn()} />)
    expect(screen.getByText('A previous transfer was restored. Receipt checks never resend it.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Refresh receipt' })); await screen.findByText('Transfer confirmed')
    expect(transfers.executeTransfer).not.toHaveBeenCalled(); expect(rpc.rpc).not.toHaveBeenCalled(); expect(identity.provider.request).not.toHaveBeenCalled()
  })
  it('copies the public receive address when clipboard permission is available', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    mount(() => <ReceiveDialog address={owner} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))
    await screen.findByText('Copied'); expect(writeText).toHaveBeenCalledWith(owner)
  })
  it('falls back to a selected address field when clipboard copying is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    mount(() => <ReceiveDialog address={owner} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }))
    await screen.findByText('Copy the address manually')
    const field = screen.getByRole('textbox', { name: 'Wallet address' }) as HTMLInputElement
    expect(field).toHaveFocus(); expect(field.selectionEnd).toBe(owner.length)
  })
})
