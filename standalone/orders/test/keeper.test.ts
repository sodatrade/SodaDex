import { afterEach, describe, expect, it } from 'vitest'
import { OrdersKeeper } from '../src/keeper.ts'
import { OrdersService } from '../src/service.ts'
import { OrderStore } from '../src/store.ts'
import { environment, executor, order, sign } from './fixture.ts'
const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()))
describe('keeper exact execution and durable broadcast recovery', () => {
  it('keeps an unmet signed minimum open without signing, broadcasting or consuming nonce', async () => {
    const env = environment(true); cleanups.push(env.cleanup); env.chain.failSimulation = true
    const value = order(), service = new OrdersService(env.config, env.store, env.chain)
    const accepted = await service.accept({ order: value, signature: await sign(value) })
    let signed = 0
    const keeper = new OrdersKeeper(env.config, env.store, env.chain, { address: executor.address, async signTransaction(plan) { signed++; return executor.signTransaction(plan) } })
    await keeper.runOnce()
    expect(env.store.get(accepted.order.id)).toMatchObject({ status: 'open', reason: 'awaiting_price' })
    expect(signed).toBe(0); expect(env.chain.broadcasts).toHaveLength(0); expect(env.chain.status).toBe(0); expect(env.store.executions()).toHaveLength(0)
  })
  it('persists signed bytes before broadcast and after restart only rebroadcasts that identical transaction', async () => {
    const env = environment(true); cleanups.push(env.cleanup); env.chain.failBroadcast = true
    const value = order(), service = new OrdersService(env.config, env.store, env.chain)
    const accepted = await service.accept({ order: value, signature: await sign(value) })
    let signed = 0, savedBeforeBroadcast = false
    const signer = { address: executor.address, async signTransaction(plan: Parameters<typeof executor.signTransaction>[0]) { signed++; return executor.signTransaction(plan) } }
    env.chain.onBroadcast = () => { savedBeforeBroadcast = env.store.executions().length === 1 }
    await new OrdersKeeper(env.config, env.store, env.chain, signer).runOnce()
    expect(savedBeforeBroadcast).toBe(true)
    expect(env.store.get(accepted.order.id)).toMatchObject({ status: 'pending', reason: 'broadcast_unknown' })
    const prepared = env.store.executions()[0]
    env.store.close(); env.chain.onBroadcast = null; env.chain.failBroadcast = false
    const reopened = new OrderStore(env.path)
    try {
      const keeper = new OrdersKeeper(env.config, reopened, env.chain, signer)
      await keeper.runOnce()
      expect(signed).toBe(1)
      expect(env.chain.broadcasts).toHaveLength(2)
      expect(env.chain.broadcasts.every(raw => raw === prepared.rawTransaction)).toBe(true)
      env.chain.completedReceipt = { hash: prepared.hash, succeeded: true, filled: true, gasCostWei: 100000n, observation: (await env.chain.observe()).observation }; env.chain.status = 2
      await keeper.runOnce()
      expect(reopened.get(accepted.order.id)).toMatchObject({ status: 'filled', txHash: prepared.hash })
      expect(reopened.gasCommitted()).toBe(100000n)
      expect(reopened.executions()).toHaveLength(0)
      expect(JSON.stringify(reopened.get(accepted.order.id)).includes(prepared.rawTransaction)).toBe(false)
    } finally { reopened.close() }
  })
  it('requires explicit signer and positive gas budget, and refuses to sign beyond the total budget', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    const value = order(), accepted = await new OrdersService(env.config, env.store, env.chain).accept({ order: value, signature: await sign(value) })
    expect(() => new OrdersKeeper(env.config, env.store, env.chain)).toThrow('injected signer')
    let signed = 0
    await new OrdersKeeper({ ...env.config, gasBudgetWei: 199999n }, env.store, env.chain, { address: executor.address, async signTransaction(plan) { signed++; return executor.signTransaction(plan) } }).runOnce()
    expect(signed).toBe(0)
    expect(env.store.get(accepted.order.id)).toMatchObject({ status: 'open', reason: 'gas_budget' })
    expect(env.chain.broadcasts).toHaveLength(0)
  })
  it('never broadcasts in default disabled mode and reconciles actual cancellation or expiration first', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    const accepted = await new OrdersService(env.config, env.store, env.chain).accept({ order: order(), signature: await sign(order()) })
    let signed = 0
    const keeper = new OrdersKeeper({ ...env.config, executionEnabled: false }, env.store, env.chain, { address: executor.address, async signTransaction(plan) { signed++; return executor.signTransaction(plan) } })
    await keeper.runOnce()
    expect(env.store.get(accepted.order.id)).toMatchObject({ status: 'open', reason: 'execution_disabled' })
    env.chain.status = 1; await keeper.runOnce()
    expect(env.store.get(accepted.order.id)?.status).toBe('cancelled')
    expect(signed).toBe(0)
    expect(env.chain.broadcasts).toHaveLength(0)
  })
  it('rejects signer substitution before storing or broadcasting a wrong transaction', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    await new OrdersService(env.config, env.store, env.chain).accept({ order: order(), signature: await sign(order()) })
    const keeper = new OrdersKeeper(env.config, env.store, env.chain, { address: executor.address, async signTransaction(plan) { return executor.signTransaction({ ...plan, to: executor.address }) } })
    await keeper.runOnce()
    expect(env.store.executions()).toHaveLength(0)
    expect(env.chain.broadcasts).toHaveLength(0)
  })
})
