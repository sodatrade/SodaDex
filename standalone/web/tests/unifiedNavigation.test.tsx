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
describe('DEX navigation after mining retirement', () => {
  it('removes the retired mining entry while preserving DEX navigation', async () => {
    const change = vi.fn()
    render(<PreferencesProvider><Header page="swap" onPageChange={change} wallet={wallet} onWallet={() => {}} onPreferences={() => {}} /></PreferencesProvider>)
    expect(screen.queryByRole('link', { name: '矿机交易' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '募资分红' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '矿机碎片' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '交易' }))
    expect(change).toHaveBeenCalledWith('swap')
  })
  it('keeps an in-flight historical mining screen from navigating away', () => {
    render(<PreferencesProvider><Header page="swap" miningPage="fragments" navigationDisabled
      onPageChange={vi.fn()} wallet={wallet} onWallet={() => {}} onPreferences={() => {}} /></PreferencesProvider>)
    expect(screen.queryByRole('link', { name: '矿机交易' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '交易' })).toBeDisabled()
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
