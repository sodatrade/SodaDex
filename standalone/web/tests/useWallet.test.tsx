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
})
