import {
  connectWallet,
  firstAccount,
  isProvider,
  providerChainId,
  switchToXLayer,
  walletError,
  type WalletErrorCode,
  type WalletIdentity,
  type WalletOption,
  type WalletSession,
} from './wallet'

export type WalletStatus = 'idle' | 'connecting' | 'switching'

/**
 * Provider discovery and consent are local UI state; no account access runs on page load.
 * Sessions hold wallet provider objects, so reactive fields are `$state.raw` and never deep-proxied.
 * `identity` is a plain field: trade execution reads it synchronously between wallet calls.
 */
export class WalletController {
  options = $state.raw<WalletOption[]>([])
  session = $state.raw<WalletSession | undefined>(undefined)
  status = $state<WalletStatus>('idle')
  error = $state<WalletErrorCode | undefined>(undefined)

  #identity: WalletIdentity | undefined
  #revision = 0
  #attempt = 0
  #subscription = 0
  #chainEventRevision = 0
  #unsubscribe: (() => void) | undefined

  getIdentity = (): WalletIdentity | undefined => this.#identity

  #updateSession(value: WalletSession | undefined): void {
    this.#revision += 1
    this.#identity = value ? { ...value, revision: this.#revision } : undefined
    this.session = value
  }

  #register(option: WalletOption): void {
    if (this.options.some((entry) => entry.provider === option.provider || entry.id === option.id)) return
    this.options = [...this.options, option]
  }

  /** EIP-6963 discovery plus the legacy injected provider. Returns the listener cleanup. */
  discover(): () => void {
    const announce = (event: Event): void => {
      const detail: unknown = (event as CustomEvent<unknown>).detail
      if (
        typeof detail !== 'object' ||
        detail === null ||
        !('provider' in detail) ||
        !isProvider(detail.provider) ||
        !('info' in detail)
      )
        return
      const info = detail.info
      if (
        typeof info === 'object' &&
        info !== null &&
        'uuid' in info &&
        typeof info.uuid === 'string' &&
        'name' in info &&
        typeof info.name === 'string'
      )
        this.#register({ id: info.uuid, name: info.name.slice(0, 60), provider: detail.provider })
    }
    window.addEventListener('eip6963:announceProvider', announce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    const injected: unknown = (window as Window & { ethereum?: unknown }).ethereum
    if (isProvider(injected)) this.#register({ id: 'injected', name: 'Browser wallet', provider: injected })
    return () => window.removeEventListener('eip6963:announceProvider', announce)
  }

  disconnect = (): void => {
    this.#attempt += 1
    this.#subscription += 1
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#revision += 1
    this.#identity = undefined
    this.session = undefined
    this.error = undefined
    this.status = 'idle'
  }

  /** Invalidates every pending request and listener; the controller stays usable afterwards. */
  destroy(): void {
    this.#attempt += 1
    this.#subscription += 1
    this.#unsubscribe?.()
    this.#revision += 1
    this.#identity = undefined
  }

  connect = async (option: WalletOption): Promise<void> => {
    const currentAttempt = ++this.#attempt
    const currentSubscription = ++this.#subscription
    this.#unsubscribe?.()
    this.#revision += 1
    this.#identity = undefined
    this.session = undefined
    this.status = 'connecting'
    this.error = undefined
    let observedAddress: WalletSession['address'] | undefined
    let observedChain: number | undefined
    const provider = option.provider
    // Subscribe before the first wallet request; events during approval must not be lost.
    const accountsChanged = (value: unknown): void => {
      if (currentSubscription !== this.#subscription) return
      const address = firstAccount(value)
      if (!address) {
        this.disconnect()
        return
      }
      observedAddress = address
      this.#revision += 1
      const current = this.#identity
      if (current?.provider === provider) {
        this.#identity = { ...current, address, revision: this.#revision }
        this.session = { ...option, address, chainId: current.chainId }
      }
    }
    const chainChanged = (value: unknown): void => {
      if (currentSubscription !== this.#subscription) return
      try {
        const chainId = providerChainId(value)
        this.#chainEventRevision += 1
        observedChain = chainId
        this.#revision += 1
        const current = this.#identity
        if (current?.provider === provider) {
          this.#identity = { ...current, chainId, revision: this.#revision }
          this.session = { ...option, address: current.address, chainId }
        }
      } catch {
        this.disconnect()
      }
    }
    const providerDisconnected = (): void => {
      if (currentSubscription === this.#subscription) this.disconnect()
    }
    try {
      this.#unsubscribe = () => {
        provider.removeListener?.('accountsChanged', accountsChanged)
        provider.removeListener?.('chainChanged', chainChanged)
        provider.removeListener?.('disconnect', providerDisconnected)
      }
      provider.on?.('accountsChanged', accountsChanged)
      provider.on?.('chainChanged', chainChanged)
      provider.on?.('disconnect', providerDisconnected)
      const connected = await connectWallet(option)
      if (currentAttempt === this.#attempt)
        this.#updateSession({
          ...connected,
          address: observedAddress ?? connected.address,
          chainId: observedChain ?? connected.chainId,
        })
    } catch (cause: unknown) {
      if (currentAttempt === this.#attempt) {
        this.#unsubscribe?.()
        this.#unsubscribe = undefined
        this.error = walletError(cause)
      }
    } finally {
      if (currentAttempt === this.#attempt) this.status = 'idle'
    }
  }

  switchChain = async (): Promise<void> => {
    const session = this.session
    if (!session) return
    const currentAttempt = ++this.#attempt
    const eventRevision = this.#chainEventRevision
    this.status = 'switching'
    this.error = undefined
    try {
      const chainId = await switchToXLayer(session.provider)
      if (currentAttempt === this.#attempt && eventRevision === this.#chainEventRevision)
        this.#updateSession({ ...session, address: this.#identity?.address ?? session.address, chainId })
    } catch (cause: unknown) {
      if (currentAttempt === this.#attempt) this.error = walletError(cause)
    } finally {
      if (currentAttempt === this.#attempt) this.status = 'idle'
    }
  }
}
