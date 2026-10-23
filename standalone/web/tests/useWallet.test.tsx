import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWallet } from '../src/lib/useWallet'
import type { Eip1193Provider, WalletOption } from '../src/lib/wallet'

const accountA = '0x1111111111111111111111111111111111111111'
const accountB = '0x2222222222222222222222222222222222222222'

function eventProvider(request: Eip1193Provider['request']): {
  option: WalletOption
  emit: (event: string, value: unknown) => void
  count: () => number
} {
  const listeners = new Map<string, Set<(value: unknown) => void>>()
  const provider: Eip1193Provider = {
    request,
    on: (event, listener) => {
      const handlers = listeners.get(event) ?? new Set()
      handlers.add(listener)
      listeners.set(event, handlers)
    },
    removeListener: (event, listener) => {
      listeners.get(event)?.delete(listener)
    },
  }
  return {
    option: { id: 'test', name: 'Test wallet', provider },
    emit: (event, value) => {
      listeners.get(event)?.forEach((listener) => listener(value))
    },
    count: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  }
}

describe('wallet event ordering', () => {
  it('uses the newest account event received while initial chain lookup is pending', async () => {
    let resolveChain: ((value: unknown) => void) | undefined
    const request = vi.fn<Eip1193Provider['request']>().mockImplementation(async ({ method }) => {
      if (method === 'eth_requestAccounts') {
        return [accountA]
      }
      return new Promise((resolve) => {
        resolveChain = resolve
      })
    })
    const provider = eventProvider(request)
    const { result } = renderHook(() => useWallet())
    let connecting: Promise<void> | undefined
    act(() => {
      connecting = result.current.connect(provider.option)
    })
    await waitFor(() => expect(resolveChain).toBeTypeOf('function'))
    expect(provider.count()).toBe(3)
    act(() => provider.emit('accountsChanged', [accountB]))
    await act(async () => {
      resolveChain?.('0xc4')
      await connecting
    })
    expect(result.current.session?.address).toBe(accountB)
  })

  it('does not revive a connection revoked during the initial chain lookup', async () => {
    let resolveChain: ((value: unknown) => void) | undefined
    const provider = eventProvider(async ({ method }) =>
      method === 'eth_requestAccounts'
        ? [accountA]
        : new Promise((resolve) => {
            resolveChain = resolve
          }),
    )
    const { result } = renderHook(() => useWallet())
    let connecting: Promise<void> | undefined
    act(() => {
      connecting = result.current.connect(provider.option)
    })
    await waitFor(() => expect(resolveChain).toBeTypeOf('function'))
    act(() => provider.emit('accountsChanged', []))
    await act(async () => {
      resolveChain?.('0xc4')
      await connecting
    })
    expect(result.current.session).toBeUndefined()
    expect(result.current.status).toBe('idle')
    expect(provider.count()).toBe(0)
  })

  it('does not replace a newer chain event with a delayed switch confirmation', async () => {
    let deferChain = false
    let resolveChain: ((value: unknown) => void) | undefined
    const provider = eventProvider(async ({ method }) => {
      if (method === 'eth_requestAccounts') {
        return [accountA]
      }
      if (method === 'wallet_switchEthereumChain') {
        provider.emit('chainChanged', '0xc4')
        deferChain = true
        return null
      }
      return deferChain
        ? new Promise((resolve) => {
            resolveChain = resolve
          })
        : '0x1'
    })
    const { result } = renderHook(() => useWallet())
    await act(async () => {
      await result.current.connect(provider.option)
    })
    let switching: Promise<void> | undefined
    act(() => {
      switching = result.current.switchChain()
    })
    await waitFor(() => expect(resolveChain).toBeTypeOf('function'))
    act(() => provider.emit('chainChanged', '0x1'))
    await act(async () => {
      resolveChain?.('0xc4')
      await switching
    })
    expect(result.current.session?.chainId).toBe(1)
    expect(result.current.status).toBe('idle')
    expect(provider.count()).toBe(3)
  })
  it('preserves a newer account while a chain switch lookup is deferred and invalidates the synchronous trade identity', async () => {
    let resolveChain: ((value: unknown) => void) | undefined
    let switching = false
    const provider = eventProvider(async ({ method }) => {
      if (method === 'eth_requestAccounts') return [accountA]
      if (method === 'wallet_switchEthereumChain') {
        switching = true
        return null
      }
      return switching
        ? new Promise((resolve) => {
            resolveChain = resolve
          })
        : '0x1'
    })
    const { result } = renderHook(() => useWallet())
    await act(async () => {
      await result.current.connect(provider.option)
    })
    const previous = result.current.getIdentity()?.revision
    let pending: Promise<void> | undefined
    act(() => {
      pending = result.current.switchChain()
    })
    await waitFor(() => expect(resolveChain).toBeTypeOf('function'))
    act(() => {
      provider.emit('accountsChanged', [accountB])
      expect(result.current.getIdentity()?.address).toBe(accountB)
      expect(result.current.getIdentity()?.revision).not.toBe(previous)
    })
    await act(async () => {
      resolveChain?.('0xc4')
      await pending
    })
    expect(result.current.session?.address).toBe(accountB)
    expect(result.current.session?.chainId).toBe(196)
  })
})

describe('same-site wallet continuity', () => {
  it('restores only an explicitly selected wallet using read-only accounts and the actual current chain', async () => {
    const { rememberWallet } = await import('../src/lib/walletConsent')
    const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_accounts' ? [accountA] : '0x7a0')
    const option = { id: 'injected', name: 'Browser', provider: { request } }
    rememberWallet(option)
    Object.assign(window, { ethereum: option.provider })
    const { result, unmount } = renderHook(() => useWallet())
    await waitFor(() => expect(result.current.session?.address).toBe(accountA))
    expect(result.current.session?.chainId).toBe(1952)
    expect(request.mock.calls.map(([x]) => x.method)).toEqual(['eth_accounts', 'eth_chainId'])
    act(() => result.current.disconnect())
    unmount()
    const reloaded = renderHook(() => useWallet())
    expect(reloaded.result.current.session).toBeUndefined()
    expect(request).toHaveBeenCalledTimes(2)
    delete (window as Window & { ethereum?: Eip1193Provider }).ethereum
  })

  it('does not ask a locked wallet for access while restoring a prior connection', async () => {
    const { rememberWallet, rememberedWallet } = await import('../src/lib/walletConsent')
    const request = vi.fn(async () => [])
    const option = { id: 'injected', name: 'Browser', provider: { request } }
    rememberWallet(option)
    Object.assign(window, { ethereum: option.provider })
    const { result } = renderHook(() => useWallet())
    await waitFor(() => expect(request).toHaveBeenCalledOnce())
    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(result.current.session).toBeUndefined()
    expect(result.current.error).toBeUndefined()
    expect(rememberedWallet()).toBeUndefined()
    expect(request).toHaveBeenCalledWith({ method: 'eth_accounts' })
    delete (window as Window & { ethereum?: Eip1193Provider }).ethereum
  })
})


it('restores an injected provider even if it announces EIP-6963 before fallback registration', async () => {
  const { rememberWallet } = await import('../src/lib/walletConsent')
  const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_accounts' ? [accountA] : '0x7a0')
  const provider = { request }
  rememberWallet({ id: 'injected', name: 'Browser', provider })
  Object.assign(window, { ethereum: provider })
  const announce = (): void => { window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: { provider, info: { uuid: 'new-page-uuid', name: 'Fixture', rdns: 'com.fixture.wallet' } },
  })) }
  window.addEventListener('eip6963:requestProvider', announce)
  const { result } = renderHook(() => useWallet())
  await waitFor(() => expect(result.current.session?.address).toBe(accountA))
  expect(result.current.session?.id).toBe('new-page-uuid')
  expect(request.mock.calls.map(([x]) => x.method)).toEqual(['eth_accounts', 'eth_chainId'])
  window.removeEventListener('eip6963:requestProvider', announce)
  delete (window as Window & { ethereum?: Eip1193Provider }).ethereum
})
