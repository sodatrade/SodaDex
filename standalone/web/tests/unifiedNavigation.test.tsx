import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Header } from '../src/components/Header'
import { PreferencesProvider } from '../src/preferences/PreferencesProvider'
import { apiPath } from '../src/lib/apiPath'
import { miningTab } from '../src/mining/navigation'
import type { WalletController } from '../src/lib/useWallet'
const wallet: WalletController = { options: [], session: undefined, status: 'idle', error: undefined,
  connect: async () => {}, switchChain: async () => {}, disconnect: () => {}, getIdentity: () => undefined }
afterEach(() => vi.unstubAllEnvs())
describe('unified main navigation and fixed mining mount', () => {
  it('links both mining businesses on the same origin and preserves existing DEX navigation', async () => {
    const change = vi.fn()
    render(<PreferencesProvider><Header page="swap" onPageChange={change} wallet={wallet} onWallet={() => {}} onPreferences={() => {}} /></PreferencesProvider>)
    expect(screen.getByRole('link', { name: '募资分红' })).toHaveAttribute('href', '/mining/#fundraising')
    expect(screen.getByRole('link', { name: '矿机碎片' })).toHaveAttribute('href', '/mining/#fragments')
    expect(screen.getByRole('link', { name: '矿机碎片' })).not.toHaveAttribute('target')
    await userEvent.click(screen.getByRole('button', { name: '交易', exact: true }))
    expect(change).toHaveBeenCalledWith('swap')
  })
  it('blocks navigation while a mining transaction is awaiting completion', async () => {
    const change = vi.fn()
    render(<PreferencesProvider><Header page="swap" miningPage="fragments" navigationDisabled onMiningPageChange={change}
      onPageChange={change} wallet={wallet} onWallet={() => {}} onPreferences={() => {}} /></PreferencesProvider>)
    expect(screen.getByRole('link', { name: '矿机碎片' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(screen.getByRole('link', { name: '募资分红' }))
    expect(change).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '交易', exact: true })).toBeDisabled()
  })
  it('mounts mining reads and signed-service requests without selecting an arbitrary network', () => {
    vi.stubEnv('BASE_URL', '/mining/')
    expect(apiPath('/api/rpc')).toBe('/mining/api/rpc')
    expect(apiPath('/api/mining/challenge')).toBe('/mining/api/mining/challenge')
    expect(apiPath('/api/network')).toBe('/mining/api/network')
    vi.stubEnv('BASE_URL', '/')
    expect(apiPath('/api/rpc')).toBe('/api/rpc')
    vi.stubEnv('BASE_URL', '//malicious.example/')
    expect(() => apiPath('/api/rpc')).toThrow()
  })
  it('restores every mining subpage from its hash without accepting an external route', () => {
    for (const tab of ['fundraising', 'fragments', 'positions', 'history', 'launch', 'automation']) expect(miningTab(`#${tab}`)).toBe(tab)
    expect(miningTab('#https://example.org')).toBe('fundraising')
  })
})
