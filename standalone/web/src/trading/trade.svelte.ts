import type { Hex } from 'viem'
import { rpc } from '../lib/rpc'
import { executeTrade } from './execution'
import { receiptStatus } from './receipts'
import { tradeError, type Quote, type TradeErrorCode, type TradeIdentity, type TradeProgress } from './types'

export type TradeNotice =
  | { type: 'submitted'; kind: 'approval' | 'swap'; hash: Hex }
  | { type: 'confirmed'; kind: 'approval' | 'swap'; hash: Hex }
  | { type: 'failed'; code: TradeErrorCode; hash?: Hex }

export interface TradeOptions {
  getIdentity: () => TradeIdentity | undefined
  /** Increments whenever the reviewed form changes; a running trade stops at its next check. */
  formRevision: () => number
  notify?: (notice: TradeNotice) => void
  onSettled?: () => void
}

export class TradeController {
  progress = $state.raw<TradeProgress | undefined>(undefined)
  lastSubmitted = $state.raw<TradeProgress | undefined>(undefined)
  error = $state<TradeErrorCode | undefined>(undefined)
  checking = $state(false)
  busy = $state(false)
  /** A submitted hash without a final receipt locks the form until the receipt is checked. */
  unresolved = $derived(this.progress?.stage === 'tradeConfirming' && !!this.progress.hash)

  #run = 0
  #submittedIdentity: TradeIdentity | undefined
  // The latest emitted progress, read synchronously so each wallet transaction is announced once.
  #latest: TradeProgress | undefined
  #options: TradeOptions

  constructor(options: TradeOptions) {
    this.#options = options
  }

  #notify(notice: TradeNotice): void {
    this.#options.notify?.(notice)
  }

  #pendingHash(): TradeProgress | undefined {
    const latest = this.#latest
    return latest?.stage === 'tradeConfirming' && latest.hash ? latest : undefined
  }

  #track(next: TradeProgress): void {
    const before = this.#pendingHash()
    this.#latest = next
    if (before?.kind === 'approval' && before.hash && next.hash !== before.hash)
      this.#notify({ type: 'confirmed', kind: 'approval', hash: before.hash })
    if (next.stage === 'tradeConfirming' && next.hash && next.kind && next.hash !== before?.hash)
      this.#notify({ type: 'submitted', kind: next.kind, hash: next.hash })
    if (next.stage === 'tradeSucceeded' && next.hash) this.#notify({ type: 'confirmed', kind: 'swap', hash: next.hash })
  }

  execute = (quote: Quote, identity: TradeIdentity): void => {
    if (this.busy || this.unresolved) return
    void this.#execute(quote, identity)
  }

  async #execute(quote: Quote, identity: TradeIdentity): Promise<void> {
    this.busy = true
    this.#submittedIdentity = identity
    const currentRun = ++this.#run
    const revision = this.#options.formRevision()
    this.error = undefined
    this.#latest = undefined
    try {
      await executeTrade(quote, {
        identity,
        getIdentity: this.#options.getIdentity,
        isCurrentForm: () => this.#run === currentRun && this.#options.formRevision() === revision,
        onProgress: (next) => {
          this.#track(next)
          if (next.hash) this.lastSubmitted = next
          this.progress = next
        },
      })
      this.#options.onSettled?.()
    } catch (cause) {
      const code = tradeError(cause)
      this.error = code
      const pending = this.#pendingHash()
      // Only the post-receipt identity check throws this, so the approval itself did confirm.
      if (pending?.kind === 'approval' && pending.hash && code === 'tradeIdentityChanged') {
        this.#notify({ type: 'confirmed', kind: 'approval', hash: pending.hash })
        this.#notify({ type: 'failed', code })
      } else this.#notify({ type: 'failed', code, hash: pending?.hash })
    } finally {
      this.busy = false
    }
  }

  recheck = async (): Promise<void> => {
    const identity = this.#submittedIdentity
    const progress = this.progress
    if (!identity || !progress?.hash || !progress.to) return
    this.checking = true
    try {
      const status = await receiptStatus(rpc, progress.hash, identity.address, progress.to)
      if (status === 'pending') {
        this.error = 'tradePending'
        this.#notify({ type: 'failed', code: 'tradePending', hash: progress.hash })
      } else {
        if (progress.kind) this.#notify({ type: 'confirmed', kind: progress.kind, hash: progress.hash })
        this.error = progress.kind === 'approval' ? 'tradeReviewAgain' : undefined
        this.progress = {
          ...progress,
          stage: progress.kind === 'swap' ? 'tradeSucceeded' : 'tradePreparing',
          hash: progress.kind === 'swap' ? progress.hash : undefined,
        }
        this.#options.onSettled?.()
      }
    } catch (cause) {
      const code = tradeError(cause)
      this.error = code
      this.#notify({ type: 'failed', code, hash: progress.hash })
      // A proven onchain revert is terminal; transport failure keeps the submitted hash locked.
      if (code === 'tradeReverted') this.progress = { ...progress, stage: 'tradePreparing' }
    } finally {
      this.checking = false
    }
  }

  cancel = (): void => {
    this.#run += 1
  }

  reset = (): void => {
    if (!this.busy && !this.unresolved) {
      this.progress = undefined
      this.error = undefined
    }
  }

  destroy(): void {
    this.#run += 1
  }
}
