import type { ExecutionSigner, KeeperNonceObservation, OrderChain } from './chain-types.ts'
import { ChainFailure } from './chain-types.ts'
import type { OrderRuntimeConfig } from './config.ts'
import { GasBudgetExceeded, OrderRepository, type StoredExecution } from './repository.ts'
import { reconcile } from './service.ts'
import { validateSignedExecution, validateStoredExecution } from './signed-transaction.ts'
export class OrdersKeeper {
  readonly config: OrderRuntimeConfig; readonly store: OrderRepository; readonly chain: OrderChain; readonly signer: ExecutionSigner | undefined; readonly now: () => number
  constructor(config: OrderRuntimeConfig, store: OrderRepository, chain: OrderChain, signer?: ExecutionSigner, now = (): number => Math.floor(Date.now() / 1000)) {
    if (config.executionEnabled && !signer) throw Error('Execution requires an explicitly injected signer')
    this.config = config; this.store = store; this.chain = chain; this.signer = signer; this.now = now
  }
  private async restoreKnownNonce(signer: ExecutionSigner['address'], state: KeeperNonceObservation): Promise<boolean> {
    const prior = this.store.executionAtNonce(signer, state.nonce)
    if (!prior || ['prepared', 'broadcast'].includes(prior.status)) return false
    const order = this.store.privateOrder(prior.orderId)
    if (!order || await this.chain.receipt(prior.hash, order.public.order)) throw new ChainFailure('unavailable')
    // A reorg may undo even a previously confirmed nonce-consumption proof. Recover the saved raw bytes first.
    this.store.restoreExecution(prior, state)
    return true
  }
  async recover(attempt: StoredExecution): Promise<void> {
    const stored = this.store.privateOrder(attempt.orderId)
    if (!stored) throw Error('Prepared execution has no order')
    await validateStoredExecution(attempt.rawTransaction, attempt.hash, attempt.signer, attempt.nonce, attempt.maxCostWei, stored.public.order, stored.signature)
    const receipt = await this.chain.receipt(attempt.hash, stored.public.order)
    if (receipt) {
      if (receipt.gasCostWei < 0n || receipt.gasCostWei > attempt.maxCostWei) throw new ChainFailure('unavailable')
      const observed = await this.chain.observe(stored.public.order, stored.public.observation ?? undefined)
      if (receipt.succeeded && (!receipt.filled || observed.nonceStatus !== 2)) throw new ChainFailure('unavailable')
      let current = reconcile(this.store, stored.public, observed, this.now())
      this.store.finish(attempt.hash, receipt.succeeded, receipt.gasCostWei)
      current = reconcile(this.store, current, { ...observed, previousObservationCanonical: true }, this.now())
      this.store.update(attempt.orderId, { status: current.status, reason: receipt.succeeded || !['open', 'pending'].includes(current.status) ? current.reason : 'transaction_reverted', txHash: current.status === 'filled' && !receipt.succeeded ? null : attempt.hash }, this.now())
      return
    }
    const current = reconcile(this.store, stored.public, await this.chain.observe(stored.public.order, stored.public.observation ?? undefined), this.now())
    const keeperNonce = await this.chain.keeperNonce(attempt.signer)
    if (keeperNonce.nonce > attempt.nonce) { this.store.resolveConsumedNonce(attempt, keeperNonce); return }
    if (keeperNonce.nonce < attempt.nonce && await this.restoreKnownNonce(attempt.signer, keeperNonce)) return
    if (!this.config.executionEnabled || !this.signer || this.signer.address.toLowerCase() !== attempt.signer.toLowerCase()) return
    const status = ['open', 'pending'].includes(current.status) ? 'pending' : current.status
    if (this.store.gasCommitted() > this.config.gasBudgetWei) { this.store.update(current.id, { status, reason: 'gas_budget' }, this.now()); return }
    try {
      await this.store.durable()
      const hash = await this.chain.broadcast(attempt.rawTransaction)
      if (hash !== attempt.hash) throw new ChainFailure('unavailable')
      this.store.broadcast(attempt.hash)
      this.store.update(current.id, { status, reason: null }, this.now())
    } catch { this.store.update(current.id, { status, reason: 'broadcast_unknown' }, this.now()) }
  }
  async runOnce(options: { maxOrders?: number; maxRecoveries?: number; stopAfterRecovery?: boolean } = {}): Promise<{ processed: number; busy: boolean }> {
    const maxOrders = options.maxOrders ?? 16, maxRecoveries = options.maxRecoveries ?? 16
    if (![maxOrders, maxRecoveries].every(value => Number.isInteger(value) && value >= 0 && value <= 16)) throw Error('Keeper cycle bounds must be 0..16')
    const owner = crypto.randomUUID()
    if (!this.store.acquire(owner)) return { processed: 0, busy: true }
    let processed = 0
    try {
      if (this.config.settlement === null || !await this.chain.ready()) return { processed, busy: false }
      for (const attempt of this.store.executions(maxRecoveries)) { await this.recover(attempt); processed++ }
      // An unresolved signed nonce is recovered first. Never create a replacement or a new signed nonce blindly.
      if (this.store.hasAnyExecution() || (options.stopAfterRecovery && processed > 0)) return { processed, busy: false }
      for (const current of this.store.nextEligible(maxOrders)) {
        const stored = this.store.privateOrder(current.id)!
        let latest
        try { latest = reconcile(this.store, current, await this.chain.observe(current.order, current.observation ?? undefined), this.now()) } catch { this.store.update(current.id, { status: current.status, reason: 'chain_unavailable' }, this.now()); continue }
        if (!['open', 'pending'].includes(latest.status) || latest.reason === 'nonce_unavailable' || latest.reason === 'chain_unavailable') continue
        try { await this.chain.simulate(current.order, stored.signature, this.signer?.address ?? current.order.maker) } catch (error) {
          this.store.update(current.id, { status: 'open', reason: error instanceof ChainFailure && error.kind === 'price' ? 'awaiting_price' : 'simulation_failed' }, this.now()); continue
        }
        if (!this.config.executionEnabled || !this.signer) { this.store.update(current.id, { status: 'open', reason: 'execution_disabled' }, this.now()); continue }
        try {
          const plan = await this.chain.plan(current.order, stored.signature, this.signer.address)
          if (await this.restoreKnownNonce(this.signer.address, await this.chain.keeperNonce(this.signer.address))) break
          if (this.store.executionAtNonce(this.signer.address, plan.nonce)) throw new ChainFailure('unavailable')
          const maximum = plan.gas * plan.gasPrice
          if (this.store.gasCommitted() + maximum > this.config.gasBudgetWei) throw new GasBudgetExceeded()
          const raw = await this.signer.signTransaction(plan)
          const hash = await validateSignedExecution(raw, plan, this.signer.address)
          const attempt = this.store.prepare(current.id, hash, raw, this.signer.address, plan.nonce, maximum, this.config.gasBudgetWei, this.now())
          await this.store.durable()
          await this.recover(attempt)
          processed++
          // Wait for the receipt/recovery before selecting another keeper nonce.
          if (this.store.hasAnyExecution()) break
        } catch (error) {
          if (this.store.hasAnyExecution()) break
          this.store.update(current.id, { status: 'open', reason: error instanceof GasBudgetExceeded ? 'gas_budget' : 'chain_unavailable' }, this.now())
        }
      }
      return { processed, busy: false }
    } finally { this.store.release(owner) }
  }
}
