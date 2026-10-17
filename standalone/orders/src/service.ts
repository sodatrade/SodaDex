import type { Hex } from 'viem'
import { parseLimitOrder } from '../../order-types.ts'
import { FIXED, type OrdersConfig } from './config.ts'
import { orderId } from './chain.ts'
import type { NonceObservation, OrderChain } from './chain-types.ts'
import { OrderStore } from './store.ts'
import type { OrdersStatus, PublicOrder } from './types.ts'
export class ServiceError extends Error {
  readonly code: string; readonly status: number
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code }
}
export function reconcile(store: OrderStore, current: PublicOrder, state: NonceObservation, now: number): PublicOrder {
  const derived = state.nonceStatus === 2 ? 'filled' : state.nonceStatus === 1 ? 'cancelled' : state.observation.timestamp >= Number(current.order.expiry) ? 'expired' : 'open'
  const rolledBack = ['filled', 'cancelled', 'expired'].includes(current.status) && current.status !== derived
  const recoveringRaw = store.hasExecution(current.id) || (rolledBack && state.previousObservationCanonical === false && store.hasExecution(current.id, true))
  const status = derived === 'open' && recoveringRaw ? 'pending' : derived
  const reason = derived !== 'open' ? null : state.permitNonceUsed ? 'nonce_unavailable'
    : rolledBack ? state.previousObservationCanonical === false ? null : 'chain_unavailable'
    : current.reason === 'nonce_unavailable' || current.reason === 'chain_unavailable' ? null : current.reason
  return store.applyChainObservation(current, { status, reason, observation: state.observation }, state.previousObservationCanonical, now)
}
export class OrdersService {
  readonly config: OrdersConfig; readonly store: OrderStore; readonly chain: OrderChain; readonly now: () => number
  constructor(config: OrdersConfig, store: OrderStore, chain: OrderChain, now = (): number => Math.floor(Date.now() / 1000)) { this.config = config; this.store = store; this.chain = chain; this.now = now }
  async status(): Promise<OrdersStatus> {
    let ready = false
    if (this.config.settlement !== null) { try { ready = await this.chain.ready() } catch { /* Expose readiness only, never upstream diagnostics or encoded signatures. */ } }
    return { schemaVersion: 1, service: 'sodadex-orders', chainId: 196, settlement: this.config.settlement, permit2: FIXED.permit2, wrappedNative: FIXED.wrappedNative, testDeployment: true, executionEnabled: ready && this.config.executionEnabled, acceptingOrders: ready && this.config.executionEnabled, reason: this.config.settlement === null ? 'NOT_DEPLOYED' : !ready ? 'CHAIN_UNAVAILABLE' : this.config.executionEnabled ? null : 'EXECUTION_PAUSED' }
  }
  async accept(body: unknown): Promise<{ order: PublicOrder; created: boolean }> {
    if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).length !== 2 || !Object.hasOwn(body, 'order') || !Object.hasOwn(body, 'signature')) throw new ServiceError(400, 'VALIDATION_FAILED', 'Expected exactly order and signature')
    const payload = body as { order: unknown; signature: unknown }
    if (typeof payload.signature !== 'string' || !/^0x(?:[0-9a-fA-F]{2}){1,4096}$/.test(payload.signature)) throw new ServiceError(400, 'VALIDATION_FAILED', 'Invalid signature encoding')
    const readiness = await this.status()
    if (this.config.settlement === null || readiness.reason === 'CHAIN_UNAVAILABLE') throw new ServiceError(503, readiness.reason ?? 'CHAIN_UNAVAILABLE', 'Order settlement is unavailable')
    let order
    try { order = parseLimitOrder(payload.order, { settlement: this.config.settlement, wrappedNative: FIXED.wrappedNative, router: FIXED.router, permit2: FIXED.permit2 }) } catch { throw new ServiceError(400, 'VALIDATION_FAILED', 'Invalid order binding, fields or values') }
    const signature = payload.signature.toLowerCase() as Hex
    const id = orderId(order)
    const existing = this.store.get(id)
    if (!existing && !readiness.acceptingOrders) throw new ServiceError(503, 'EXECUTION_PAUSED', 'New order admission is paused')
    const state = await this.chain.observe(order, existing?.observation ?? undefined)
    if (!await this.chain.verifySignature(order, signature, state.observation)) throw new ServiceError(401, 'INVALID_SIGNATURE', 'Order signature is invalid')
    if (existing) return { order: reconcile(this.store, existing, state, this.now()), created: false }
    if (state.nonceStatus !== 0 || state.permitNonceUsed) throw new ServiceError(409, 'NONCE_UNAVAILABLE', 'Maker nonce is unavailable on chain')
    if (BigInt(order.expiry) <= BigInt(state.observation.timestamp)) throw new ServiceError(400, 'ORDER_EXPIRED', 'Order has expired on chain')
    return this.store.insert(id, order, signature, state.observation, this.now())
  }
  async get(id: Hex): Promise<PublicOrder | null> {
    const current = this.store.get(id)
    if (!current) return null
    if (this.config.settlement === null) return current
    try { return reconcile(this.store, current, await this.chain.observe(current.order, current.observation ?? undefined), this.now()) } catch {
      return ['filled', 'cancelled', 'expired'].includes(current.status) ? current : this.store.update(id, { status: current.status, reason: 'chain_unavailable' }, this.now())
    }
  }
  async list(maker: string, limit: number, cursor?: string): Promise<{ orders: PublicOrder[]; nextCursor: string | null }> {
    const page = this.store.list(maker, limit, cursor)
    if (this.config.settlement === null) return page
    const orders: PublicOrder[] = []
    // A terminal row must also be rechecked: list polling is how clients recover after a reorganization.
    // Bound RPC concurrency instead of issuing up to one hundred simultaneous signature-state reads.
    for (let start = 0; start < page.orders.length; start += 4) {
      const batch = page.orders.slice(start, start + 4)
      orders.push(...await Promise.all(batch.map(async current => await this.get(current.id) ?? current)))
    }
    return { orders, nextCursor: page.nextCursor }
  }
}
