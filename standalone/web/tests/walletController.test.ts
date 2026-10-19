import { describe, expect, it, vi } from 'vitest'
import { WalletController } from '../src/lib/wallet.svelte'
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

/** A chain lookup that stays pending until the test resolves it. */
function deferredChain(): { pending: () => Promise<unknown>; resolve: (value: unknown) => void; started: () => boolean } {
  let resolveChain: ((value: unknown) => void) | undefined
  return {
    pending: () =>
      new Promise((resolve) => {
        resolveChain = resolve
      }),
    resolve: (value) => resolveChain?.(value),
    started: () => resolveChain !== undefined,
  }
}

describe('wallet event ordering', () => {
  it('uses the newest account event received while initial chain lookup is pending', async () => {
    const chain = deferredChain()
    const request = vi
      .fn<Eip1193Provider['request']>()
      .mockImplementation(async ({ method }) => (method === 'eth_requestAccounts' ? [accountA] : chain.pending()))
    const provider = eventProvider(request)
    const wallet = new WalletController()
    const connecting = wallet.connect(provider.option)
    await vi.waitFor(() => expect(chain.started()).toBe(true))
    expect(provider.count()).toBe(3)
    provider.emit('accountsChanged', [accountB])
    chain.resolve('0xc4')
    await connecting
    expect(wallet.session?.address).toBe(accountB)
  })

  it('does not revive a connection revoked during the initial chain lookup', async () => {
    const chain = deferredChain()
    const provider = eventProvider(async ({ method }) => (method === 'eth_requestAccounts' ? [accountA] : chain.pending()))
    const wallet = new WalletController()
    const connecting = wallet.connect(provider.option)
    await vi.waitFor(() => expect(chain.started()).toBe(true))
    provider.emit('accountsChanged', [])
    chain.resolve('0xc4')
    await connecting
    expect(wallet.session).toBeUndefined()
    expect(wallet.status).toBe('idle')
    expect(provider.count()).toBe(0)
  })

  it('does not replace a newer chain event with a delayed switch confirmation', async () => {
    const chain = deferredChain()
    let deferChain = false
    const provider = eventProvider(async ({ method }) => {
      if (method === 'eth_requestAccounts') return [accountA]
      if (method === 'wallet_switchEthereumChain') {
        provider.emit('chainChanged', '0xc4')
        deferChain = true
        return null
      }
      return deferChain ? chain.pending() : '0x1'
    })
    const wallet = new WalletController()
    await wallet.connect(provider.option)
    const switching = wallet.switchChain()
    await vi.waitFor(() => expect(chain.started()).toBe(true))
    provider.emit('chainChanged', '0x1')
    chain.resolve('0xc4')
    await switching
    expect(wallet.session?.chainId).toBe(1)
    expect(wallet.status).toBe('idle')
    expect(provider.count()).toBe(3)
  })

  it('preserves a newer account while a chain switch lookup is deferred and invalidates the synchronous trade identity', async () => {
    const chain = deferredChain()
    let switching = false
    const provider = eventProvider(async ({ method }) => {
      if (method === 'eth_requestAccounts') return [accountA]
      if (method === 'wallet_switchEthereumChain') {
        switching = true
        return null
      }
      return switching ? chain.pending() : '0x1'
    })
    const wallet = new WalletController()
    await wallet.connect(provider.option)
    const previous = wallet.getIdentity()?.revision
    const pending = wallet.switchChain()
    await vi.waitFor(() => expect(chain.started()).toBe(true))
    provider.emit('accountsChanged', [accountB])
    expect(wallet.getIdentity()?.address).toBe(accountB)
    expect(wallet.getIdentity()?.revision).not.toBe(previous)
    chain.resolve('0xc4')
    await pending
    expect(wallet.session?.address).toBe(accountB)
    expect(wallet.session?.chainId).toBe(196)
  })

  it('keeps wallet provider objects out of deep reactive proxies', async () => {
    const provider = eventProvider(async ({ method }) => (method === 'eth_requestAccounts' ? [accountA] : '0xc4'))
    const wallet = new WalletController()
    await wallet.connect(provider.option)
    expect(wallet.session?.provider).toBe(provider.option.provider)
    expect(wallet.getIdentity()?.provider).toBe(provider.option.provider)
  })
})
