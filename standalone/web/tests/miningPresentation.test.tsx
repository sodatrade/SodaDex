import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MiningActionCard } from '../src/mining/ActionCard'
import { MiningActionWorkspace } from '../src/mining/ActionWorkspace'
import { MiningHistoryPanel } from '../src/mining/HistoryPanel'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { MINING_TEST_ACCOUNT, MINING_TEST_HASH, miningTestAddress } from './fixtures/miningProducts'

vi.mock('../src/network', async () => {
  const { networkProfile } = await import('../../network-profile')
  return { NETWORK: networkProfile('1952-mining-test') }
})
afterEach(() => localStorage.clear())

describe('mining task presentation', () => {
  it('lets visitors select an action and enter an amount before connecting, without allowing submission', async () => {
    const preview = vi.fn(), connect = vi.fn(), user = userEvent.setup()
    render(<PreferencesProvider><MiningActionCard title="兑换" actions={['fragmentBuy', 'fragmentSell']} disabled onConnect={connect} onPreview={preview} /></PreferencesProvider>)
    await user.type(screen.getByRole('textbox', { name: '数量' }), '12')
    await user.click(screen.getByRole('button', { name: 'FAB 换碎片' }))
    expect(preview).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '碎片换 FAB' }))
    expect(screen.getByRole('textbox', { name: '数量' })).toHaveValue('')
    await user.type(screen.getByRole('textbox', { name: '数量' }), '2')
    await user.click(screen.getByRole('button', { name: '连接钱包' }))
    expect(connect).toHaveBeenCalledOnce()
    expect(preview).not.toHaveBeenCalled()
  })
  it('shows one task at a time and retains LP slippage and exact submitted asset quantities', async () => {
    const preview = vi.fn().mockResolvedValue(undefined), user = userEvent.setup()
    render(<PreferencesProvider><MiningActionWorkspace kind="fragments" disabled={false} busy={false} onPreview={preview} /></PreferencesProvider>)
    expect(screen.getAllByRole('button', { name: '预览交易' })).toHaveLength(1)
    expect(screen.queryByRole('textbox', { name: 'TEST-FAB 数量' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /流动性 添加/ }))
    await user.type(screen.getByRole('textbox', { name: '数量' }), '0.000000000000000001')
    await user.type(screen.getByRole('textbox', { name: 'TEST-FAB 数量' }), '0.00000001')
    await user.click(screen.getByRole('button', { name: '添加碎片流动性' }))
    expect(preview).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '预览交易' }))
    expect(preview).toHaveBeenLastCalledWith('fragmentAdd', '0.000000000000000001', '0.00000001', 250)
    await user.click(screen.getByRole('button', { name: '移除碎片流动性' }))
    expect(screen.queryByRole('textbox', { name: 'TEST-FAB 数量' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '数量' })).toHaveValue('')
  })
  it('freezes task selection and fields during execution and removes redundant single-action selectors', () => {
    const { rerender } = render(<PreferencesProvider><MiningActionWorkspace kind="fragments" disabled busy onPreview={vi.fn()} /></PreferencesProvider>)
    for (const button of within(screen.getByRole('group', { name: '选择操作' })).getAllByRole('button')) expect(button).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '数量' })).toBeDisabled()
    rerender(<PreferencesProvider><MiningActionCard title="获取测试 FAB" actions={['getTestFab']} disabled={false} onPreview={vi.fn()} /></PreferencesProvider>)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('0.5%')).toBeVisible()
  })
  it('keeps project liquidity unavailable until its pair exists', async () => {
    const preview = vi.fn(), user = userEvent.setup()
    render(<PreferencesProvider><MiningActionWorkspace kind="fundraising" symbol="TEST-A" hasPair={false} disabled={false} busy={false} onPreview={preview} /></PreferencesProvider>)
    await user.click(screen.getByRole('button', { name: /流动性 添加/ }))
    await user.type(screen.getByRole('textbox', { name: '数量' }), '1')
    await user.type(screen.getByRole('textbox', { name: 'TEST-FAB 数量' }), '1')
    expect(screen.getByRole('button', { name: '预览交易' })).toBeDisabled()
    expect(screen.getByText(/当前没有可用的交易流动性/)).toBeVisible()
    expect(preview).not.toHaveBeenCalled()
  })
  it('filters the visible journal by wallet without mutating saved submissions', async () => {
    const entries = [{ hash: MINING_TEST_HASH, from: MINING_TEST_ACCOUNT, to: miningTestAddress(1), action: 'fragmentBuy', status: 'success' as const, at: 1_760_000_000_000 },
      { hash: `0x${'b'.repeat(64)}` as const, from: miningTestAddress(901), to: miningTestAddress(1), action: 'fragmentSell', status: 'pending' as const, at: 9_000_000_000_000_000 }]
    const update = vi.fn(), user = userEvent.setup()
    render(<PreferencesProvider><MiningHistoryPanel entries={entries} account={MINING_TEST_ACCOUNT} onUpdate={update} /></PreferencesProvider>)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: '当前钱包' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('FAB 换碎片')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '本机全部' }))
    expect(screen.getByRole('button', { name: '查询回执' })).toBeEnabled()
    expect(update).not.toHaveBeenCalled()
    expect(entries).toHaveLength(2)
  })
  it('pages saved transactions newest first and resets pagination when the wallet filter changes', async () => {
    const entries = Array.from({ length: 23 }, (_, index) => ({ hash: `0x${index.toString(16).padStart(64, '0')}` as const,
      from: index < 4 ? MINING_TEST_ACCOUNT : miningTestAddress(901), to: miningTestAddress(1),
      action: 'fragmentBuy', status: 'success' as const, at: 1_760_000_000_000 + index }))
    const user = userEvent.setup()
    render(<PreferencesProvider><MiningHistoryPanel entries={entries} account={MINING_TEST_ACCOUNT} onUpdate={vi.fn()} /></PreferencesProvider>)
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('title', entries[22].hash)
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('title', entries[12].hash)
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '当前钱包' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.queryByRole('navigation', { name: '分页' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '本机全部' }))
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(entries).toHaveLength(23)
  })
})
