import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { toHex, type Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { STABLE_ADDRESS } from '../src/domain/assets'
import { ExplorePage } from '../src/features/explore/ExplorePage'
import { ReferencePoolsPanel } from '../src/features/explore/ReferencePoolsPanel'
import { TokenDetail } from '../src/features/explore/TokenDetail'
import { TokenList } from '../src/features/explore/TokenList'
import * as reference from '../src/features/explore/referenceApi'
import * as pools from '../src/liquidity/pools'
import * as rpc from '../src/lib/rpc'
import type { WalletController } from '../src/lib/useWallet'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { GlobalSearchDialog } from '../src/components/GlobalSearchDialog'
import * as market from '../src/features/market/api'
import { referencePool, referencePools, referenceToken } from './exploreFixtures'
const wallet: WalletController = { options: [], session: undefined, status: 'idle', error: undefined, connect: vi.fn(), switchChain: vi.fn(), disconnect: vi.fn(), getIdentity: vi.fn() }
function mount(ui: ReactElement): void {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><PreferencesProvider>{ui}</PreferencesProvider></QueryClientProvider>)
}
describe('Explore user paths', () => {
  it('caps all combined global search results at ten and keeps the official entry reachable', async () => {
    vi.spyOn(reference, 'getReferenceTokens').mockResolvedValue(Array.from({ length: 23 }, (_, i) => ({ ...referenceToken,
      address: `0x${(i + 1).toString(16).padStart(40, '0')}` as Address, symbol: `TOKEN${i}`, name: `Token ${i}` })))
    vi.spyOn(market, 'getPools').mockResolvedValue({ schemaVersion: 1, chainId: 196, asOf: referencePools.asOf,
      coverage: { fromBlock: 1, toBlock: 10, complete: true, nextFromBlock: null }, pools: [] })
    const user = userEvent.setup(), onReference = vi.fn()
    mount(<GlobalSearchDialog onClose={vi.fn()} onAsset={vi.fn()} onPool={vi.fn()} onReference={onReference} onToken={vi.fn()} />)
    await screen.findByRole('button', { name: '下一页' })
    expect(document.querySelectorAll('.global-search-results .asset-option')).toHaveLength(10)
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(document.querySelectorAll('.global-search-results .asset-option')).toHaveLength(10)
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(document.querySelectorAll('.global-search-results .asset-option').length).toBeLessThanOrEqual(10)
    await user.click(screen.getByRole('button', { name: /查看官方池只读数据/ }))
    expect(onReference).toHaveBeenCalledOnce()
    await user.type(screen.getByLabelText('搜索名称、代号或地址'), 'TOKEN0')
    expect(document.querySelectorAll('.global-search-results .asset-option')).toHaveLength(1)
  })
  it('pages the catalog and resets to the first page when filtering by a token', async () => {
    vi.spyOn(reference, 'getReferenceTokens').mockResolvedValue(Array.from({ length: 23 }, (_, i) => ({ ...referenceToken,
      address: `0x${(i + 1).toString(16).padStart(40, '0')}` as Address, symbol: `TOKEN${i}`, name: `Token ${i}` })))
    const onToken = vi.fn(), user = userEvent.setup()
    mount(<TokenList onToken={onToken} />)
    await screen.findByRole('button', { name: '下一页' })
    expect(screen.getAllByRole('row')).toHaveLength(11)
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getAllByRole('row')).toHaveLength(11)
    await user.type(screen.getByLabelText('搜索名称、符号或地址'), 'TOKEN22')
    expect(screen.getAllByRole('row')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /TOKEN22/ }))
    expect(onToken).toHaveBeenCalledWith(`0x${(23).toString(16).padStart(40, '0')}`)
    expect(screen.queryByRole('navigation', { name: '分页' })).not.toBeInTheDocument()
  })
  it('keeps every official pool reachable while rendering at most ten per page', async () => {
    vi.spyOn(reference, 'getReferencePools').mockResolvedValue({ ...referencePools, pools: Array.from({ length: 23 }, (_, i) => ({ ...referencePool,
      id: `0x${(i + 1).toString(16).padStart(40, '0')}`, address: `0x${(i + 1).toString(16).padStart(40, '0')}` as Address })) })
    const user = userEvent.setup(); mount(<ReferencePoolsPanel />)
    await screen.findByRole('button', { name: '下一页' })
    expect(screen.getAllByRole('article')).toHaveLength(10)
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getAllByRole('article')).toHaveLength(10)
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  })
  it('searches a de-duplicated official catalog by symbol and complete address', async () => {
    vi.spyOn(reference, 'getReferenceTokens').mockResolvedValue([referenceToken, { ...referenceToken, address: '0x1111111111111111111111111111111111111111', symbol: 'XYZ', name: 'Token XYZ' }])
    const onToken = vi.fn(), user = userEvent.setup()
    mount(<TokenList onToken={onToken} />)
    await user.type(screen.getByLabelText('搜索名称、符号或地址'), 'XYZ')
    await user.click(await screen.findByRole('button', { name: /XYZ/ }))
    expect(onToken).toHaveBeenCalledWith('0x1111111111111111111111111111111111111111')
    await user.clear(screen.getByLabelText('搜索名称、符号或地址'))
    await user.type(screen.getByLabelText('搜索名称、符号或地址'), STABLE_ADDRESS.toLowerCase())
    expect(screen.getAllByRole('button', { name: /USD₮0/ })).toHaveLength(1)
  })
  it('shows exact token balance and its full fixed-network address without signing', async () => {
    const request = vi.fn()
    vi.spyOn(pools, 'listPools').mockResolvedValue([])
    vi.spyOn(rpc, 'rpc').mockResolvedValue(toHex(1234567n, { size: 32 }))
    const session = { id: 'test', name: 'test', provider: { request }, address: '0x1111111111111111111111111111111111111111' as const, chainId: 196 }
    mount(<TokenDetail address={STABLE_ADDRESS} wallet={{ ...wallet, session }} onConnect={vi.fn()} onBack={vi.fn()} />)
    expect(await screen.findByText('1.234567 USD₮0')).toBeVisible()
    expect(screen.getByRole('link', { name: STABLE_ADDRESS })).toHaveAttribute('href', `https://www.oklink.com/xlayer/address/${STABLE_ADDRESS}`)
    expect(await screen.findByText('已读取的 SodaDEX 池中没有此资产。')).toBeVisible()
    expect(request).not.toHaveBeenCalled()
  })
  it('quotes official pools read-only in exact output units and retries failures', async () => {
    const user = userEvent.setup(), getPools = vi.spyOn(reference, 'getReferencePools').mockRejectedValueOnce(Error('offline')).mockResolvedValue(referencePools)
    vi.spyOn(reference, 'getReferenceQuote').mockResolvedValue({ schemaVersion: 1, chainId: 196, source: 'uniswap', readOnly: true,
      amountInRaw: '1', amountOutRaw: '900719925474099300000001', tokenIn: referencePool.token0.address, tokenOut: referencePool.token1.address, poolId: referencePool.id, protocol: 'v3' })
    mount(<ReferencePoolsPanel />)
    await user.click(await screen.findByRole('button', { name: '重试' }))
    await user.click(await screen.findByRole('button', { name: '查看只读报价 →' }))
    await user.type(screen.getByLabelText('查询数量 · USD₮0'), '0.000001')
    expect(await screen.findByText('900719.925474099300000001 WOKB')).toBeVisible()
    expect(screen.getByText(/不能在此授权或提交交易/)).toBeVisible()
    expect(screen.queryByRole('button', { name: /授权|确认兑换|连接钱包/ })).not.toBeInTheDocument()
    expect(getPools).toHaveBeenCalledTimes(2)
  })
  it('distinguishes no candidate pool from a failed discovery and reports tab changes', async () => {
    const user = userEvent.setup(), onTabChange = vi.fn()
    vi.spyOn(reference, 'getReferenceTokens').mockResolvedValue([referenceToken])
    vi.spyOn(reference, 'getReferencePools').mockResolvedValue({ ...referencePools, pools: [], errors: [{ protocol: 'v3', fee: 500, tickSpacing: null, message: 'failed' }] })
    mount(<ExplorePage wallet={wallet} onConnect={vi.fn()} onSwap={vi.fn()} onTabChange={onTabChange} />)
    await user.click(screen.getByRole('button', { name: '官方池 · 只读' }))
    await waitFor(() => expect(onTabChange).toHaveBeenCalledWith('reference'))
    expect(await screen.findByText(/部分候选读取失败/)).toBeVisible()
    expect(screen.queryByText('此币对在所查候选范围内没有可用池。')).not.toBeInTheDocument()
  })
  it('keeps failed balances unavailable instead of displaying zero and allows retry', async () => {
    const user = userEvent.setup()
    vi.spyOn(pools, 'listPools').mockResolvedValue([])
    vi.spyOn(rpc, 'rpc').mockRejectedValueOnce(Error('offline')).mockResolvedValue(toHex(1n, { size: 32 }))
    const session = { id: 'test', name: 'test', provider: { request: vi.fn() }, address: '0x1111111111111111111111111111111111111111' as const, chainId: 196 }
    mount(<TokenDetail address={STABLE_ADDRESS} wallet={{ ...wallet, session }} onConnect={vi.fn()} onBack={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: '重试' }))
    expect(await screen.findByText('0.000001 USD₮0')).toBeVisible()
    expect(screen.queryByText('0 USD₮0')).not.toBeInTheDocument()
  })
  it('searches a new own pool with explicit source and navigates official results without a wallet', async () => {
    const user = userEvent.setup(), onPool = vi.fn(), onReference = vi.fn(), onToken = vi.fn()
    vi.spyOn(reference, 'getReferenceTokens').mockResolvedValue([referenceToken])
    vi.spyOn(market, 'getPools').mockResolvedValue({ schemaVersion: 1, chainId: 196, asOf: referencePools.asOf,
      coverage: { fromBlock: 1, toBlock: 10, complete: true, nextFromBlock: null }, pools: [{ protocol: 'v3', id: referencePool.id, address: referencePool.address,
        token0: STABLE_ADDRESS, token1: referencePool.token1.address, fee: 500, tickSpacing: 10, hooks: '0x0000000000000000000000000000000000000000', createdBlock: 10,
        source: 'chain', sqrtPriceX96: '1', tick: 0, liquidity: '100', stateError: null }] })
    mount(<GlobalSearchDialog onClose={vi.fn()} onAsset={vi.fn()} onPool={onPool} onReference={onReference} onToken={onToken} />)
    const input = screen.getByLabelText('搜索名称、代号或地址')
    await user.type(input, referencePool.id)
    await user.click(await screen.findByRole('button', { name: /USD₮0 \/ WOKB.*SodaDEX/s }))
    expect(onPool).toHaveBeenCalledOnce()
    await user.clear(input); await user.type(input, 'uniswap')
    await user.click(screen.getByRole('button', { name: /查看官方池只读数据/ }))
    expect(onReference).toHaveBeenCalledOnce()
    await user.clear(input); await user.type(input, '0x2222222222222222222222222222222222222222')
    await user.click(screen.getByRole('button', { name: /代币详情/ }))
    expect(onToken).toHaveBeenCalledWith('0x2222222222222222222222222222222222222222')
  })
})
