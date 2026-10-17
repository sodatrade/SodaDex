import { afterEach, describe, expect, it, vi } from 'vitest'
import { orderTypedData } from '../../order-types.ts'
import { FIXED } from '../src/config.ts'
import { OrdersService } from '../src/service.ts'
import { environment, executor, maker, order, sign } from './fixture.ts'
import { OrdersKeeper } from '../src/keeper.ts'
const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()))
describe('signed order admission and authoritative state', () => {
  it('accepts canonical signatures idempotently and retains cancellation/filled terminal results', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    const service = new OrdersService(env.config, env.store, env.chain), value = order(), signature = await sign(value)
    const first = await service.accept({ order: value, signature })
    expect(first.created).toBe(true)
    env.chain.status = 1
    expect((await service.get(first.order.id))?.status).toBe('cancelled')
    expect((await service.accept({ order: value, signature })).order.status).toBe('cancelled')
    expect((await service.accept({ order: value, signature })).created).toBe(false)
  })
  it('rejects changed order fields, forged domains, unknown fields and reused Permit2 nonces', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    const service = new OrdersService(env.config, env.store, env.chain), value = order(), signature = await sign(value)
    await expect(service.accept({ order: { ...value, minAmountOut: '2' }, signature })).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' })
    const typed = orderTypedData(value, FIXED.permit2)
    const wrongDomain = await maker.signTypedData({ ...typed, domain: { ...typed.domain, chainId: 1 } })
    await expect(service.accept({ order: value, signature: wrongDomain })).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' })
    await expect(service.accept({ order: value, signature, rpc: 'https://attacker.example' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    env.chain.permitNonceUsed = true
    await expect(service.accept({ order: value, signature })).rejects.toMatchObject({ code: 'NONCE_UNAVAILABLE' })
  })
  it('uses observed chain timestamp for expiration and never treats HTTP submission as cancellation', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    const service = new OrdersService(env.config, env.store, env.chain), value = order(), signature = await sign(value)
    const accepted = await service.accept({ order: value, signature })
    env.chain.timestamp = 2000
    expect((await service.get(accepted.order.id))?.status).toBe('expired')
    expect((await service.accept({ order: value, signature })).order.status).toBe('expired')
    const later = order('3')
    await expect(service.accept({ order: later, signature: await sign(later) })).rejects.toMatchObject({ code: 'ORDER_EXPIRED' })
  })
  it('reports null deployment unavailable even when a fake transport claims readiness', async () => {
    const env = environment(); cleanups.push(env.cleanup)
    const service = new OrdersService({ ...env.config, settlement: null }, env.store, env.chain)
    expect(await service.status()).toMatchObject({ settlement: null, executionEnabled: false, acceptingOrders: false, reason: 'NOT_DEPLOYED' })
    await expect(service.accept({ order: order(), signature: '0x01' })).rejects.toMatchObject({ code: 'NOT_DEPLOYED' })
  })
  it('pauses only new admission while retaining deployment, old order reads and authoritative cancellation', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    const value = order(), signature = await sign(value)
    const accepted = await new OrdersService(env.config, env.store, env.chain).accept({ order: value, signature })
    const paused = new OrdersService({ ...env.config, executionEnabled: false }, env.store, env.chain)
    expect(await paused.status()).toMatchObject({ settlement: env.config.settlement, executionEnabled: false, acceptingOrders: false, reason: 'EXECUTION_PAUSED' })
    const other = order('2')
    await expect(paused.accept({ order: other, signature: await sign(other) })).rejects.toMatchObject({ status: 503, code: 'EXECUTION_PAUSED' })
    expect((await paused.accept({ order: value, signature })).created).toBe(false)
    expect(env.store.list(value.maker, 100).orders).toHaveLength(1)
    env.chain.status = 1
    expect((await paused.get(accepted.order.id))?.status).toBe('cancelled')
    expect((await paused.accept({ order: value, signature })).order.status).toBe('cancelled')
    expect(env.chain.broadcasts).toHaveLength(0)
  })
  it('restores a reorged cancellation from a canonical snapshot without letting duplicate submissions reset a real terminal state', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    const service = new OrdersService(env.config, env.store, env.chain), value = order(), signature = await sign(value)
    const accepted = await service.accept({ order: value, signature })
    env.chain.status = 1
    expect((await service.get(accepted.order.id))?.status).toBe('cancelled')
    env.chain.status = 0; env.chain.previousCanonical = false
    expect(await service.get(accepted.order.id)).toMatchObject({ status: 'open', reason: null })
    expect(env.store.privateOrder(accepted.order.id)?.signature).toBe(signature)
    env.chain.status = 1; env.chain.previousCanonical = true
    expect((await service.get(accepted.order.id))?.status).toBe('cancelled')
    expect((await service.accept({ order: value, signature })).order.status).toBe('cancelled')
    expect(env.store.update(accepted.order.id, { status: 'open' }, 1001).status).toBe('cancelled')
  })
  it('keeps the cancel entry recoverable when an old terminal observation cannot be proven orphaned', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    const service = new OrdersService(env.config, env.store, env.chain), value = order(), signature = await sign(value)
    const accepted = await service.accept({ order: value, signature })
    env.chain.status = 1; await service.get(accepted.order.id)
    env.chain.status = 0
    expect(await service.get(accepted.order.id)).toMatchObject({ status: 'open', reason: 'chain_unavailable' })
  })
  it('keeps a globally consumed Permit2 nonce cancellable, but never simulates or signs it as executable', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    const service = new OrdersService(env.config, env.store, env.chain), value = order(), signature = await sign(value)
    const accepted = await service.accept({ order: value, signature })
    env.chain.status = 1; await service.get(accepted.order.id)
    env.chain.status = 0; env.chain.previousCanonical = false; env.chain.permitNonceUsed = true
    expect(await service.get(accepted.order.id)).toMatchObject({ status: 'open', reason: 'nonce_unavailable' })
    const simulate = vi.spyOn(env.chain, 'simulate'), signing = vi.fn().mockRejectedValue(Error('must not sign'))
    await new OrdersKeeper(env.config, env.store, env.chain, { address: executor.address, signTransaction: signing }).runOnce()
    expect(simulate).not.toHaveBeenCalled(); expect(signing).not.toHaveBeenCalled(); expect(env.chain.broadcasts).toHaveLength(0)
    env.chain.status = 1
    expect((await service.get(accepted.order.id))?.status).toBe('cancelled')
  })
  it('rotates a bounded list refresh instead of leaving older terminal rows permanently stale', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    const service = new OrdersService(env.config, env.store, env.chain, undefined, { maxListRefresh: 1 })
    for (const nonce of ['1', '2', '3']) { const value = order(nonce); await service.accept({ order: value, signature: await sign(value) }) }
    env.chain.status = 1
    const first = await service.list(order().maker, 100)
    expect(first.orders.filter(value => value.status === 'cancelled')).toHaveLength(1)
    const anotherService = new OrdersService(env.config, env.store, env.chain, undefined, { maxListRefresh: 1 })
    await anotherService.list(order().maker, 100)
    const third = await anotherService.list(order().maker, 100)
    expect(third.orders.every(value => value.status === 'cancelled')).toBe(true)
  })
})
