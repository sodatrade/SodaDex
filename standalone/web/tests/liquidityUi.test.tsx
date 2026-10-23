import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LiquidityPage } from '../src/features/liquidity/LiquidityPage'
import { LP_RECORD_KEY } from '../src/features/liquidity/transactionRecord'
import type { WalletController } from '../src/lib/useWallet'
import type { WalletIdentity } from '../src/lib/wallet'
import * as client from '../src/liquidity'
import type { LiquidityOperation, LiquidityPool, LiquidityPosition, LiquidityPreview } from '../src/liquidity/types'
import { LiquidityError } from '../src/liquidity/types'
import { PREFERENCES_KEY } from '../src/preferences/model'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
vi.mock('../src/liquidity', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/liquidity')>()
  return {
    ...original,
    listAllPools: vi.fn(),
    listPositions: vi.fn(),
    discoverPool: vi.fn(),
    refreshPool: vi.fn(),
    getPosition: vi.fn(),
    importCurrency: vi.fn(),
    prepareLiquidity: vi.fn(),
    executeLiquidity: vi.fn(),
    recheckLiquidityReceipt: vi.fn(),
  }
})
const owner = '0x1111111111111111111111111111111111111111' as const
const other = '0x2222222222222222222222222222222222222222' as const
const hash = `0x${'a'.repeat(64)}` as Hex
const pool: LiquidityPool = {
  protocol: 'v4',
  id: hash,
  currency0: client.NATIVE_CURRENCY,
  currency1: client.KNOWN_CURRENCIES.find((c) => c.symbol === 'USD₮0')!,
  fee: 0,
  tickSpacing: 1,
  sqrtPriceX96: 1n << 96n,
  tick: 0,
  liquidity: 1000000n,
  initialized: true,
}
const position: LiquidityPosition = {
  protocol: 'v4',
  tokenId: 7n,
  owner,
  pool,
  tickLower: -100,
  tickUpper: 100,
  liquidity: 10000n,
  amount0: 100000000000000n,
  amount1: 1000000n,
  claimable0: 100n,
  claimable1: 200n,
  fees0: 100n,
  fees1: 200n,
  inRange: true,
}
function preview(operation: LiquidityOperation): LiquidityPreview {
  return {
    operation,
    owner,
    pool,
    slippageBps: 'slippageBps' in operation ? (operation.slippageBps ?? 5) : 5,
    deadline: 1800000000n,
    liquidity: 1000n,
    amount0: operation.kind === 'collect' ? operation.position.claimable0 : 100000000000000n,
    amount1: operation.kind === 'collect' ? operation.position.claimable1 : 1000000n,
    minimum0: 90000000000000n,
    minimum1: 995000n,
    maximum0: 100000000000000n,
    maximum1: 1000000n,
    transaction: { from: owner, to: client.LP_CONTRACTS.v4Manager, value: '0x0', data: '0x' },
    approvals:
      operation.kind === 'collect' || operation.kind === 'decrease'
        ? []
        : [{ currency: pool.currency1, amount: 1000000n, spender: client.LP_CONTRACTS.permit2, permit2: true }],
  }
}
function setupWallet(
  connected = true,
  chainId = 196,
): { wallet: WalletController; identity: () => WalletIdentity | undefined; change: () => void } {
  let identity: WalletIdentity | undefined = connected
    ? { provider: { request: vi.fn() }, address: owner, chainId, revision: 1 }
    : undefined
  const wallet: WalletController = {
    options: [],
    session: identity ? { ...identity, id: 'test', name: 'Test' } : undefined,
    status: 'idle',
    error: undefined,
    connect: vi.fn(),
    switchChain: vi.fn(async () => {}),
    disconnect: vi.fn(),
    getIdentity: () => identity,
  }
  return {
    wallet,
    identity: () => identity,
    change: () => {
      identity = identity ? { ...identity, address: other, revision: identity.revision + 1 } : undefined
      if (identity) wallet.session = { ...identity, id: 'test', name: 'Test' }
    },
  }
}
function mount(wallet = setupWallet().wallet): {
  view: ReturnType<typeof render>
  onConnect: ReturnType<typeof vi.fn>
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  const onConnect = vi.fn()
  const page = (
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        <LiquidityPage wallet={wallet} onConnect={onConnect} />
      </PreferencesProvider>
    </QueryClientProvider>
  )
  const view = render(page)
  return { view, onConnect }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(client.listAllPools).mockResolvedValue([pool])
  vi.mocked(client.listPositions).mockResolvedValue([position])
  vi.mocked(client.discoverPool).mockResolvedValue(pool)
  vi.mocked(client.refreshPool).mockResolvedValue(pool)
  vi.mocked(client.getPosition).mockResolvedValue(position)
  vi.mocked(client.prepareLiquidity).mockImplementation(async (operation) => preview(operation))
  vi.mocked(client.executeLiquidity).mockImplementation(async (_preview, context) => {
    context.onProgress({ stage: 'pending', hash, kind: 'liquidity', to: client.LP_CONTRACTS.v4Manager })
    context.onProgress({ stage: 'success', hash, kind: 'liquidity', to: client.LP_CONTRACTS.v4Manager })
    return hash
  })
  vi.mocked(client.recheckLiquidityReceipt).mockResolvedValue('success')
})
it('chooses the miner pool from the shared create dialog without creating an ordinary V3/V4 pool', async () => {
  const choose=vi.fn(), {wallet}=setupWallet()
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><PreferencesProvider><LiquidityPage wallet={wallet} onConnect={vi.fn()} specialPool={{label:'矿机碎片专用池',onChoose:choose,row:<div role="row">OKB / sFAB 专用池</div>}} /></PreferencesProvider></QueryClientProvider>)
  expect(await screen.findByText('OKB / sFAB 专用池')).toBeVisible()
  await userEvent.click(screen.getByRole('button',{name:'创建池 / 新仓位'}))
  await userEvent.click(screen.getByRole('radio',{name:'矿机碎片专用池'}))
  expect(screen.queryByLabelText('资产 A')).not.toBeInTheDocument()
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'添加流动性'}))
  expect(choose).toHaveBeenCalledOnce()
  expect(client.discoverPool).not.toHaveBeenCalled()
  expect(client.executeLiquidity).not.toHaveBeenCalled()
})
async function openAmounts(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await screen.findByText('已初始化')
  await user.click(screen.getByRole('button', { name: '管理流动性' }))
  await user.click(within(screen.getByRole('dialog', { name: '管理流动性' })).getByRole('button', { name: '添加流动性' }))
  return screen.getByRole('dialog', { name: '创建池 / 新仓位' })
}
async function prepareMint(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  const dialog = await openAmounts(user)
  await user.type(within(dialog).getByLabelText('资产 0 数量 · OKB'), '0.0001')
  await user.type(within(dialog).getByLabelText('资产 1 数量 · USD₮0'), '1')
  await user.click(within(dialog).getByRole('button', { name: '预览流动性操作' }))
  return screen.findByRole('dialog', { name: '确认流动性操作' })
}
describe('self-service liquidity UI', () => {
  it('publishes a freshly verified pool once after confirmation while the directory is empty', async () => {
    const user = userEvent.setup(); mount()
    const review = await prepareMint(user)
    vi.mocked(client.listAllPools).mockResolvedValue([])
    await user.click(within(review).getByRole('button', { name: '确认并打开钱包' }))
    await waitFor(() => expect(client.refreshPool).toHaveBeenCalledWith(pool, expect.any(Function)))
    await user.click(within(review).getByRole('button', { name: '关闭' }))
    expect(await screen.findAllByRole('button', { name: '管理流动性' })).toHaveLength(1)
    expect(client.executeLiquidity).toHaveBeenCalledOnce()
  })
  it('keeps a successful receipt successful if the post-confirmation pool read fails', async () => {
    vi.mocked(client.refreshPool).mockRejectedValue(new Error('Read unavailable'))
    const user = userEvent.setup(); mount()
    const review = await prepareMint(user)
    await user.click(within(review).getByRole('button', { name: '确认并打开钱包' }))
    expect(await within(review).findByText('操作已确认，正在刷新仓位')).toBeVisible()
    await waitFor(() => expect(JSON.parse(localStorage.getItem(LP_RECORD_KEY)!).status).toBe('success'))
    expect(client.executeLiquidity).toHaveBeenCalledOnce()
  })

  it('shows verified V3 positions while V4 discovery is still pending', async () => {
    const v3 = { ...position, protocol: 'v3' as const, pool: { ...pool, protocol: 'v3' as const } }
    vi.mocked(client.listPositions).mockImplementation(async (_owner, _read, protocol) => protocol === 'v4' ? new Promise(() => {}) : [v3])
    const user = userEvent.setup(); mount()
    await user.click(screen.getByRole('button', { name: '我的仓位' }))
    expect(await screen.findByText(`V3 · #${position.tokenId}`)).toBeVisible()
    expect(screen.getByText(/V4 · 读取链上数据/)).toBeVisible()
    expect(screen.getByRole('button', { name: '减少流动性' })).toBeEnabled()
  })

  it('paginates discovered positions without a manual NFT lookup form', async () => {
    const positions = Array.from({ length: 11 }, (_, index) => ({ ...position, tokenId: BigInt(index + 1) }))
    vi.mocked(client.listPositions).mockResolvedValue(positions)
    const user = userEvent.setup(); mount()
    await user.click(screen.getByRole('button', { name: '我的仓位' }))
    await screen.findByRole('button', { name: '下一页' })
    expect(screen.getAllByRole('button', { name: '转移仓位 NFT' })).toHaveLength(10)
    expect(screen.queryByText('查找仓位 NFT')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('NFT Token ID')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getAllByRole('button', { name: '转移仓位 NFT' })).toHaveLength(1)
    expect(screen.getAllByText('V4 · #11')).toHaveLength(1)
    expect(client.executeLiquidity).not.toHaveBeenCalled()
  })
  it('refreshes discovered positions after a transfer receipt instead of keeping a stale actionable card', async () => {
    const user = userEvent.setup(); mount()
    await user.click(screen.getByRole('button', { name: '我的仓位' }))
    await user.click(await screen.findByRole('button', { name: '转移仓位 NFT' }))
    const editor = screen.getByRole('dialog', { name: /转移仓位 NFT/ })
    await user.type(within(editor).getByLabelText('接收钱包'), other)
    await user.click(within(editor).getByRole('button', { name: '预览流动性操作' }))
    const review = await screen.findByRole('dialog', { name: '确认流动性操作' })
    expect(within(review).queryByText('LP 滑点上限（%）')).not.toBeInTheDocument()
    vi.mocked(client.listPositions).mockResolvedValue([])
    await user.click(within(review).getByRole('button', { name: '确认并打开钱包' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '转移仓位 NFT' })).not.toBeInTheDocument())
    expect(client.executeLiquidity).toHaveBeenCalledOnce()
  })
  it('reviews the entire position and exact transfer recipient before requesting the wallet', async () => {
    const user = userEvent.setup(); mount()
    await user.click(screen.getByRole('button', { name: '我的仓位' }))
    await user.click(await screen.findByRole('button', { name: '转移仓位 NFT' }))
    const editor = screen.getByRole('dialog', { name: /转移仓位 NFT/ })
    await user.type(within(editor).getByLabelText('接收钱包'), other)
    await user.click(within(editor).getByRole('button', { name: '预览流动性操作' }))
    const review = await screen.findByRole('dialog', { name: '确认流动性操作' })
    expect(within(review).getByText(other)).toBeVisible()
    expect(within(review).getByText('#7')).toBeVisible()
    expect(client.executeLiquidity).not.toHaveBeenCalled()
    expect(client.prepareLiquidity).toHaveBeenCalledWith({ kind: 'transfer', position, recipient: other }, owner)
    await user.click(within(review).getByRole('button', { name: '确认并打开钱包' }))
    await waitFor(() => expect(client.executeLiquidity).toHaveBeenCalledOnce())
  })
  it('only offers empty-position burn after liquidity and claimable assets are zero', async () => {
    const empty = { ...position, liquidity: 0n, amount0: 0n, amount1: 0n, claimable0: 0n, claimable1: 0n }
    vi.mocked(client.listPositions).mockResolvedValue([empty])
    const user = userEvent.setup(); mount()
    await user.click(screen.getByRole('button', { name: '我的仓位' }))
    await user.click(await screen.findByRole('button', { name: '销毁空仓位 NFT' }))
    const editor = screen.getByRole('dialog', { name: /销毁空仓位 NFT/ })
    expect(within(editor).getByText(/Token ID 不再存在/)).toBeVisible()
    await user.click(within(editor).getByRole('button', { name: '预览流动性操作' }))
    await screen.findByRole('dialog', { name: '确认流动性操作' })
    expect(client.prepareLiquidity).toHaveBeenCalledWith({ kind: 'burn', position: empty }, owner)
    expect(client.executeLiquidity).not.toHaveBeenCalled()
  })
  it('shows real pool details without TVL or APR and requests connection only for an operation', async () => {
    const user = userEvent.setup(),
      { onConnect } = mount(setupWallet(false).wallet)
    await screen.findByText('已初始化')
    expect(screen.queryByText(/TVL|APR/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '管理流动性' }))
    const dialog = screen.getByRole('dialog', { name: '管理流动性' })
    expect(within(dialog).getByText(hash)).toBeVisible()
    expect(within(dialog).getByText('0%')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: '添加流动性' }))
    expect(onConnect).toHaveBeenCalledOnce()
    expect(client.prepareLiquidity).not.toHaveBeenCalled()
  })
  it('uses native V4 LP default 5bps, accepts a manual override, previews real max/min, and sends only after consent', async () => {
    const user = userEvent.setup()
    mount()
    const dialog = await openAmounts(user)
    expect(within(dialog).getByLabelText('LP 滑点上限（%）')).toHaveValue('0.05')
    await user.type(within(dialog).getByLabelText('资产 0 数量 · OKB'), '0.0001')
    await user.type(within(dialog).getByLabelText('资产 1 数量 · USD₮0'), '1')
    await user.clear(within(dialog).getByLabelText('LP 滑点上限（%）'))
    await user.type(within(dialog).getByLabelText('LP 滑点上限（%）'), '1.25')
    await user.click(within(dialog).getByRole('button', { name: '预览流动性操作' }))
    const review = await screen.findByRole('dialog', { name: '确认流动性操作' })
    expect(client.prepareLiquidity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'mint', amount0: 100000000000000n, amount1: 1000000n, slippageBps: 125 }),
      owner,
    )
    expect(review).toHaveTextContent('0.995 USD₮0')
    expect(within(review).getByText('最高支付')).toBeVisible()
    expect(client.executeLiquidity).not.toHaveBeenCalled()
    await user.click(within(review).getByRole('button', { name: '确认并打开钱包' }))
    await waitFor(() => expect(client.executeLiquidity).toHaveBeenCalledOnce())
    expect(await within(review).findByRole('link', { name: /最近提交/ })).toHaveAttribute(
      'href',
      `https://www.oklink.com/xlayer/tx/${hash}`,
    )
  })
  it('builds a new uninitialized V3 position using client discovery, 250bps default and explicit initial price/custom ticks', async () => {
    const user = userEvent.setup()
    vi.mocked(client.discoverPool).mockResolvedValue({ ...pool, protocol: 'v3', initialized: false, fee: 100 })
    mount()
    await user.click(screen.getByRole('button', { name: '创建池 / 新仓位' }))
    const dialog = screen.getByRole('dialog', { name: '创建池 / 新仓位' })
    await user.click(within(dialog).getByRole('button', { name: '查找 / 配置池子' }))
    expect(await within(dialog).findByLabelText('LP 滑点上限（%）')).toHaveValue('2.5')
    await user.type(within(dialog).getByLabelText(/^初始价格/), '500')
    await user.click(within(dialog).getByRole('radio', { name: '自定义 Tick' }))
    await user.clear(within(dialog).getByLabelText('下限 Tick'))
    await user.type(within(dialog).getByLabelText('下限 Tick'), '-100')
    await user.clear(within(dialog).getByLabelText('上限 Tick'))
    await user.type(within(dialog).getByLabelText('上限 Tick'), '100')
    await user.type(within(dialog).getByLabelText('资产 0 数量 · OKB'), '0.0001')
    await user.type(within(dialog).getByLabelText('资产 1 数量 · USD₮0'), '1')
    await user.click(within(dialog).getByRole('button', { name: '预览流动性操作' }))
    await waitFor(() =>
      expect(client.prepareLiquidity).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'mint',
          initialPrice: '500',
          tickLower: -100,
          tickUpper: 100,
          slippageBps: 250,
        }),
        owner,
      ),
    )
  })
  it('supports partial / full removal and collect while keeping each operation behind a preview', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: '我的仓位' }))
    await user.click(await screen.findByRole('button', { name: '减少流动性' }))
    const dialog = screen.getByRole('dialog', { name: '减少流动性 · #7' })
    await user.clear(within(dialog).getByLabelText('移出比例（%）'))
    await user.type(within(dialog).getByLabelText('移出比例（%）'), '25')
    await user.click(within(dialog).getByRole('button', { name: '预览流动性操作' }))
    await waitFor(() =>
      expect(client.prepareLiquidity).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'decrease', liquidity: 2500n, liquidityBps: 2500 }),
        owner,
      ),
    )
    await user.click(
      within(screen.getByRole('dialog', { name: '确认流动性操作' })).getByRole('button', { name: '关闭对话框' }),
    )
    await user.click(within(dialog).getByRole('button', { name: '全部移出' }))
    await user.click(within(dialog).getByRole('button', { name: '预览流动性操作' }))
    await waitFor(() =>
      expect(client.prepareLiquidity).toHaveBeenLastCalledWith(expect.objectContaining({ liquidity: 10000n }), owner),
    )
    await user.click(
      within(screen.getByRole('dialog', { name: '确认流动性操作' })).getByRole('button', { name: '关闭对话框' }),
    )
    await user.click(within(dialog).getByRole('button', { name: '关闭对话框' }))
    await user.click(screen.getByRole('button', { name: '领取资产' }))
    const collect = screen.getByRole('dialog', { name: '领取资产 · #7' })
    await user.click(within(collect).getByRole('button', { name: '预览流动性操作' }))
    await waitFor(() => expect(client.prepareLiquidity).toHaveBeenLastCalledWith({ kind: 'collect', position }, owner))
    expect(client.executeLiquidity).not.toHaveBeenCalled()
  })
  it('increases the existing NFT position while keeping its pool and tick range immutable', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: '我的仓位' }))
    await user.click(await screen.findByRole('button', { name: '增加流动性' }))
    const dialog = screen.getByRole('dialog', { name: '增加流动性' })
    expect(within(dialog).getByLabelText('下限 Tick')).toBeDisabled()
    expect(within(dialog).getByLabelText('上限 Tick')).toHaveValue('100')
    await user.type(within(dialog).getByLabelText('资产 0 数量 · OKB'), '0.0001')
    await user.type(within(dialog).getByLabelText('资产 1 数量 · USD₮0'), '1')
    await user.click(within(dialog).getByRole('button', { name: '预览流动性操作' }))
    await waitFor(() =>
      expect(client.prepareLiquidity).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'increase', position, amount1: 1000000n }),
        owner,
      ),
    )
    expect(client.executeLiquidity).not.toHaveBeenCalled()
  })
  it('keeps principal claimable after all liquidity is removed without labeling it as pure fees', async () => {
    const owed = {
      ...position,
      liquidity: 0n,
      fees0: 0n,
      fees1: 0n,
      claimable0: 1000000000000000000n,
      claimable1: 5000000n,
    }
    vi.mocked(client.listPositions).mockResolvedValue([owed])
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: '我的仓位' }))
    await screen.findByText('待领取资产（可能包含减仓本金）')
    expect(screen.getByRole('button', { name: '领取资产' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '减少流动性' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '领取资产' }))
    await user.click(
      within(screen.getByRole('dialog', { name: '领取资产 · #7' })).getByRole('button', { name: '预览流动性操作' }),
    )
    const review = await screen.findByRole('dialog', { name: '确认流动性操作' })
    expect(review).toHaveTextContent('1 OKB')
    expect(review).toHaveTextContent('5 USD₮0')
    expect(within(review).getByText('无需新增授权')).toBeVisible()
  })
  it('keeps public pools visible on a wrong chain and never prepares a write', async () => {
    const user = userEvent.setup(),
      { wallet } = setupWallet(true, 1)
    mount(wallet)
    await screen.findByText('已初始化')
    await user.click(screen.getByRole('button', { name: '创建池 / 新仓位' }))
    expect(wallet.switchChain).toHaveBeenCalledOnce()
    expect(client.prepareLiquidity).not.toHaveBeenCalled()
    expect(client.listPositions).not.toHaveBeenCalled()
  })
  it('keeps entered amounts on a preparation failure and permits an explicit retry', async () => {
    const user = userEvent.setup()
    vi.mocked(client.prepareLiquidity).mockRejectedValueOnce(new LiquidityError('poolChanged'))
    mount()
    const dialog = await openAmounts(user)
    await user.type(within(dialog).getByLabelText('资产 0 数量 · OKB'), '0.0001')
    await user.type(within(dialog).getByLabelText('资产 1 数量 · USD₮0'), '1')
    await user.click(within(dialog).getByRole('button', { name: '预览流动性操作' }))
    await within(dialog).findByText('池状态已变化，请重新预览。')
    expect(within(dialog).getByLabelText('资产 1 数量 · USD₮0')).toHaveValue('1')
    await user.click(within(dialog).getByRole('button', { name: '预览流动性操作' }))
    expect(await screen.findByRole('dialog', { name: '确认流动性操作' })).toBeVisible()
  })
  it('invalidates a final preview when the wallet account changes', async () => {
    const user = userEvent.setup(),
      state = setupWallet()
    const { view } = mount(state.wallet)
    await prepareMint(user)
    act(() => state.change())
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PreferencesProvider>
          <LiquidityPage wallet={state.wallet} onConnect={() => {}} />
        </PreferencesProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('dialog', { name: '确认流动性操作' })).toHaveTextContent('钱包、网络或输入已变化')
    expect(screen.getByRole('button', { name: '确认并打开钱包' })).toBeDisabled()
    expect(client.executeLiquidity).not.toHaveBeenCalled()
  })
  it('imports a verified ERC-20 through the client and passes its metadata into pool discovery', async () => {
    const imported = { address: other, symbol: 'TEST', name: 'Imported Test', decimals: 6, native: false }
    vi.mocked(client.importCurrency).mockResolvedValue(imported)
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: '创建池 / 新仓位' }))
    const dialog = screen.getByRole('dialog', { name: '创建池 / 新仓位' })
    await user.click(within(dialog).getByText('导入 ERC-20'))
    await user.type(within(dialog).getByLabelText('合约地址'), other)
    await user.click(within(dialog).getByRole('button', { name: '读取代币' }))
    await within(dialog).findByText('已读取代币')
    await user.click(within(dialog).getByRole('button', { name: '查找 / 配置池子' }))
    expect(client.importCurrency).toHaveBeenCalledWith(other)
    await waitFor(() =>
      expect(client.discoverPool).toHaveBeenCalledWith(expect.objectContaining({ currencyB: imported })),
    )
  })
  it('shows a positions read failure separately from a genuinely empty wallet and retries explicitly', async () => {
    vi.mocked(client.listPositions).mockRejectedValueOnce(new Error('node down')).mockResolvedValueOnce([])
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: '我的仓位' }))
    await screen.findByText(/读取未完成，请重试。/)
    expect(screen.queryByText('这个钱包还没有仓位')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByText('这个钱包还没有仓位')
  })
  it('does not publish a prepared preview if the account changes during calculation', async () => {
    let resolve: ((value: LiquidityPreview) => void) | undefined
    vi.mocked(client.prepareLiquidity).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const user = userEvent.setup(),
      state = setupWallet()
    mount(state.wallet)
    const dialog = await openAmounts(user)
    await user.type(within(dialog).getByLabelText('资产 0 数量 · OKB'), '0.0001')
    await user.type(within(dialog).getByLabelText('资产 1 数量 · USD₮0'), '1')
    await user.click(within(dialog).getByRole('button', { name: '预览流动性操作' }))
    await waitFor(() => expect(resolve).toBeTypeOf('function'))
    act(() => state.change())
    await act(async () => {
      resolve?.(preview({ kind: 'collect', position }))
    })
    expect(screen.queryByRole('dialog', { name: '确认流动性操作' })).not.toBeInTheDocument()
    expect(client.executeLiquidity).not.toHaveBeenCalled()
  })
  it('restores a pending public hash after refresh and only checks its receipt', async () => {
    localStorage.setItem(
      LP_RECORD_KEY,
      JSON.stringify({
        chainId: 196,
        hash,
        from: owner,
        to: client.LP_CONTRACTS.v4Manager,
        protocol: 'v4',
        kind: 'liquidity',
        status: 'pending',
      }),
    )
    const user = userEvent.setup()
    mount()
    expect(await screen.findByRole('link', { name: /最近提交/ })).toHaveAttribute(
      'href',
      `https://www.oklink.com/xlayer/tx/${hash}`,
    )
    expect(screen.getByRole('button', { name: '创建池 / 新仓位' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '检查交易回执' }))
    await screen.findByText('链上已确认。请刷新仓位；如需继续操作，请重新预览。')
    expect(client.executeLiquidity).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '创建池 / 新仓位' })).toBeEnabled()
  })
  it('retains a submitted hash after a timeout and never resends on receipt retry', async () => {
    vi.mocked(client.executeLiquidity).mockImplementation(async (_preview, context) => {
      context.onProgress({ stage: 'pending', hash, kind: 'liquidity', to: client.LP_CONTRACTS.v4Manager })
      throw new LiquidityError('pending')
    })
    vi.mocked(client.recheckLiquidityReceipt).mockResolvedValue('pending')
    const user = userEvent.setup()
    mount()
    const review = await prepareMint(user)
    await user.click(within(review).getByRole('button', { name: '确认并打开钱包' }))
    await waitFor(() => expect(within(review).getByRole('button', { name: '检查交易回执' })).toBeEnabled())
    await user.click(within(review).getByRole('button', { name: '检查交易回执' }))
    expect(client.executeLiquidity).toHaveBeenCalledOnce()
    expect(JSON.parse(localStorage.getItem(LP_RECORD_KEY) ?? 'null')).toMatchObject({ hash, status: 'pending' })
  })
  it('clears pending feedback after manual receipt confirmation without resending', async () => {
    vi.mocked(client.executeLiquidity).mockImplementation(async (_preview, context) => {
      context.onProgress({ stage: 'pending', hash, kind: 'liquidity', to: client.LP_CONTRACTS.v4Manager })
      throw new LiquidityError('pending')
    })
    const user = userEvent.setup()
    mount()
    const review = await prepareMint(user)
    await user.click(within(review).getByRole('button', { name: '确认并打开钱包' }))
    await waitFor(() => expect(within(review).getByRole('button', { name: '检查交易回执' })).toBeEnabled())
    await user.click(within(review).getByRole('button', { name: '检查交易回执' }))
    await screen.findByText('链上已确认。请刷新仓位；如需继续操作，请重新预览。')
    expect(screen.queryByText('交易仍待确认，请检查回执，不要重复提交。')).not.toBeInTheDocument()
    expect(client.executeLiquidity).toHaveBeenCalledOnce()
  })
  it('continues to confirm when browser storage fails and exposes the submitted explorer link', async () => {
    const user = userEvent.setup()
    mount()
    const review = await prepareMint(user)
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    try {
      await user.click(within(review).getByRole('button', { name: '确认并打开钱包' }))
      await within(review).findByText('浏览器无法保存本次记录，请保留区块浏览器链接。')
      expect(within(review).getByRole('link', { name: /最近提交/ })).toHaveAttribute(
        'href',
        `https://www.oklink.com/xlayer/tx/${hash}`,
      )
      expect(client.executeLiquidity).toHaveBeenCalledOnce()
    } finally {
      storage.mockRestore()
    }
  })
  it.each([
    { locale: 'en', title: 'Liquidity', create: 'Create pool / position' },
    { locale: 'yue-HK', title: '流動性', create: '建立池 / 新倉位' },
  ])('uses $locale for the LP entry and controls', async ({ locale, title, create }) => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale, theme: 'light', currency: 'CNY' }))
    mount()
    expect(screen.getByRole('heading', { name: title })).toBeVisible()
    expect(screen.getByRole('button', { name: create })).toBeEnabled()
  })
})
