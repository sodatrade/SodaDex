import { useCallback, useEffect, useRef, useState } from 'react'
import {
  connectWallet,
  firstAccount,
  isProvider,
  providerChainId,
  switchToXLayer,
  walletError,
  type WalletOption,
  type WalletSession,
} from './wallet'

export interface WalletController {
  options: WalletOption[]
  session: WalletSession | undefined
  status: 'idle' | 'connecting' | 'switching'
  error: string | undefined
  connect: (option: WalletOption) => Promise<void>
  switchChain: () => Promise<void>
  disconnect: () => void
}

/** Provider discovery and consent are local UI state; no account access runs on page load. */
export function useWallet(): WalletController {
  const [options, setOptions] = useState<WalletOption[]>([])
  const [session, setSession] = useState<WalletSession>()
  const [status, setStatus] = useState<WalletController['status']>('idle')
  const [error, setError] = useState<string>()
  const attempt = useRef(0)
  const subscription = useRef(0)
  const chainEventRevision = useRef(0)
  const unsubscribe = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    const register = (option: WalletOption): void => {
      setOptions((current) =>
        current.some((entry) => entry.provider === option.provider || entry.id === option.id)
          ? current
          : [...current, option],
      )
    }
    const announce = (event: Event): void => {
      const detail: unknown = (event as CustomEvent<unknown>).detail
      if (
        typeof detail !== 'object' ||
        detail === null ||
        !('provider' in detail) ||
        !isProvider(detail.provider) ||
        !('info' in detail)
      ) {
        return
      }
      const info = detail.info
      if (
        typeof info === 'object' &&
        info !== null &&
        'uuid' in info &&
        typeof info.uuid === 'string' &&
        'name' in info &&
        typeof info.name === 'string'
      ) {
        register({ id: info.uuid, name: info.name.slice(0, 60), provider: detail.provider })
      }
    }
    window.addEventListener('eip6963:announceProvider', announce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    const injected: unknown = (window as Window & { ethereum?: unknown }).ethereum
    if (isProvider(injected)) {
      register({ id: 'injected', name: '浏览器钱包', provider: injected })
    }
    return () => window.removeEventListener('eip6963:announceProvider', announce)
  }, [])

  const disconnect = useCallback((): void => {
    attempt.current += 1
    subscription.current += 1
    unsubscribe.current?.()
    unsubscribe.current = undefined
    setSession(undefined)
    setError(undefined)
    setStatus('idle')
  }, [])

  useEffect(
    () => () => {
      attempt.current += 1
      subscription.current += 1
      unsubscribe.current?.()
    },
    [],
  )

  const connect = async (option: WalletOption): Promise<void> => {
    const currentAttempt = ++attempt.current
    const currentSubscription = ++subscription.current
    unsubscribe.current?.()
    setSession(undefined)
    setStatus('connecting')
    setError(undefined)
    let observedAddress: WalletSession['address'] | undefined
    let observedChain: number | undefined
    const provider = option.provider
    // Subscribe before the first wallet request; events during approval must not be lost.
    const accountsChanged = (value: unknown): void => {
      if (currentSubscription !== subscription.current) {
        return
      }
      const address = firstAccount(value)
      if (!address) {
        disconnect()
      } else {
        observedAddress = address
        setSession((current) => (current?.provider === provider ? { ...current, address } : current))
      }
    }
    const chainChanged = (value: unknown): void => {
      if (currentSubscription !== subscription.current) {
        return
      }
      try {
        const chainId = providerChainId(value)
        chainEventRevision.current += 1
        observedChain = chainId
        setSession((current) => (current?.provider === provider ? { ...current, chainId } : current))
      } catch {
        disconnect()
      }
    }
    const providerDisconnected = (): void => {
      if (currentSubscription === subscription.current) {
        disconnect()
      }
    }
    try {
      unsubscribe.current = () => {
        provider.removeListener?.('accountsChanged', accountsChanged)
        provider.removeListener?.('chainChanged', chainChanged)
        provider.removeListener?.('disconnect', providerDisconnected)
      }
      provider.on?.('accountsChanged', accountsChanged)
      provider.on?.('chainChanged', chainChanged)
      provider.on?.('disconnect', providerDisconnected)
      const connected = await connectWallet(option)
      if (currentAttempt === attempt.current) {
        setSession({
          ...connected,
          address: observedAddress ?? connected.address,
          chainId: observedChain ?? connected.chainId,
        })
      }
    } catch (cause: unknown) {
      if (currentAttempt === attempt.current) {
        unsubscribe.current?.()
        unsubscribe.current = undefined
        setError(walletError(cause))
      }
    } finally {
      if (currentAttempt === attempt.current) {
        setStatus('idle')
      }
    }
  }

  const switchChain = async (): Promise<void> => {
    if (!session) {
      return
    }
    const currentAttempt = ++attempt.current
    const eventRevision = chainEventRevision.current
    setStatus('switching')
    setError(undefined)
    try {
      const chainId = await switchToXLayer(session.provider)
      if (currentAttempt === attempt.current && eventRevision === chainEventRevision.current) {
        setSession((current) => (current ? { ...current, chainId } : undefined))
      }
    } catch (cause: unknown) {
      if (currentAttempt === attempt.current) {
        setError(walletError(cause))
      }
    } finally {
      if (currentAttempt === attempt.current) {
        setStatus('idle')
      }
    }
  }

  return { options, session, status, error, connect, switchChain, disconnect }
}
