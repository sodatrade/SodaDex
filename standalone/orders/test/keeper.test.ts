import { afterEach, describe, expect, it } from 'vitest'
import { OrdersKeeper } from '../src/keeper.ts'
import { OrdersService } from '../src/service.ts'
import { OrderStore } from '../src/store.ts'
import { ChainFailure } from '../src/chain-types.ts'
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
  it.each(['cancelled', 'expired', 'filled'] as const)('after restart resolves a %s order raw transaction before the next order, signing each only once', async terminal => {
    const env = environment(true); cleanups.push(env.cleanup)
    const first = order(), second = { ...order('2'), expiry: '4000' }
    const service = new OrdersService(env.config, env.store, env.chain)
    const one = await service.accept({ order: first, signature: await sign(first) }), two = await service.accept({ order: second, signature: await sign(second) })
    let signed = 0
    const signer = { address: executor.address, async signTransaction(plan: Parameters<typeof executor.signTransaction>[0]) { signed++; return executor.signTransaction(plan) } }
    env.chain.failBroadcast = true
    await new OrdersKeeper(env.config, env.store, env.chain, signer).runOnce()
    const original = env.store.executions()[0]
    env.store.close()
    const reopened = new OrderStore(env.path)
    try {
      env.chain.failBroadcast = false
      env.chain.statuses.set(first.nonce, terminal === 'cancelled' ? 1 : terminal === 'filled' ? 2 : 0)
      if (terminal === 'expired') env.chain.timestamp = 2000
      const restartedService = new OrdersService(env.config, reopened, env.chain)
      expect((await restartedService.get(one.order.id))?.status).toBe(terminal)
      const at = (await env.chain.observe()).observation
      env.chain.onBroadcast = () => {
        const attempt = reopened.executions()[0], succeeding = attempt.orderId === two.order.id
        env.chain.receipts.set(attempt.hash, { hash: attempt.hash, succeeded: succeeding, filled: succeeding, gasCostWei: 100000n, observation: at })
        if (succeeding) env.chain.statuses.set(second.nonce, 2)
        env.chain.keeperNonceValue = attempt.nonce + 1; env.chain.signedNonce = attempt.nonce + 1
      }
      const keeper = new OrdersKeeper(env.config, reopened, env.chain, signer)
      await keeper.runOnce()
      expect(env.chain.broadcasts[1]).toBe(original.rawTransaction)
      expect(signed).toBe(1)
      expect(reopened.get(one.order.id)?.status).toBe(terminal)
      await keeper.runOnce(); await keeper.runOnce()
      expect(reopened.get(two.order.id)?.status).toBe('filled')
      expect(reopened.executions()).toHaveLength(0)
      expect(signed).toBe(2)
      expect(env.chain.broadcasts).toHaveLength(3)
    } finally { reopened.close() }
  })
  it('releases a missing raw transaction only with persisted canonical keeper nonce evidence, retaining its gas reserve', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    const first = order(), second = order('2'), service = new OrdersService(env.config, env.store, env.chain)
    const one = await service.accept({ order: first, signature: await sign(first) }), two = await service.accept({ order: second, signature: await sign(second) })
    let signed = 0
    const signer = { address: executor.address, async signTransaction(plan: Parameters<typeof executor.signTransaction>[0]) { signed++; return executor.signTransaction(plan) } }
    env.chain.failBroadcast = true
    const keeper = new OrdersKeeper(env.config, env.store, env.chain, signer)
    await keeper.runOnce()
    const original = env.store.executions()[0]
    env.chain.statuses.set(first.nonce, 1); env.chain.keeperNonceValue = 1; env.chain.signedNonce = 1; env.chain.failBroadcast = false
    await keeper.runOnce()
    expect(env.store.get(one.order.id)?.status).toBe('cancelled')
    expect(signed).toBe(2)
    expect(env.store.executions()).toHaveLength(1)
    expect(env.store.executions()[0].orderId).toBe(two.order.id)
    expect(env.chain.broadcasts).toHaveLength(2) // The consumed original was not rebroadcast or replaced.
    const proof = env.store.database.prepare('SELECT * FROM execution_resolutions WHERE hash=?').get(original.hash)
    expect(proof?.confirmed_nonce).toBe(1)
    expect(JSON.parse(String(proof?.observation_json))).toMatchObject({ blockNumber: '100', blockHash: `0x${'a'.repeat(64)}` })
    expect(env.store.gasCommitted()).toBe(400000n)
    // Reorg the external nonce consumption while a higher saved keeper nonce is already queued.
    env.chain.keeperNonceValue = 0; env.chain.signedNonce = 0; env.chain.previousCanonical = false; env.chain.statuses.set(first.nonce, 0)
    await keeper.runOnce()
    expect(env.store.executions()).toHaveLength(2)
    expect(env.store.executions()[0].hash).toBe(original.hash)
    expect(signed).toBe(2)
    const at = (await env.chain.observe()).observation
    env.chain.onBroadcast = () => {
      const attempt = env.store.executions().find(saved => saved.rawTransaction === env.chain.broadcasts.at(-1))!
      env.chain.receipts.set(attempt.hash, { hash: attempt.hash, succeeded: true, filled: true, gasCostWei: 100000n, observation: at })
      env.chain.statuses.set(env.store.get(attempt.orderId)!.order.nonce, 2)
      env.chain.keeperNonceValue = attempt.nonce + 1; env.chain.signedNonce = attempt.nonce + 1
    }
    await keeper.runOnce(); await keeper.runOnce()
    expect(env.store.executions()).toHaveLength(0)
    expect(env.store.get(one.order.id)?.status).toBe('filled')
    expect(env.store.get(two.order.id)?.status).toBe('filled')
    expect(signed).toBe(2)
    expect(env.store.database.prepare('SELECT * FROM execution_resolutions WHERE hash=?').get(original.hash)).toBeUndefined()
  })
  it('bounds each cycle and persists round-robin progress so an unmet first order does not starve the next', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    const first = order(), second = order('2'), service = new OrdersService(env.config, env.store, env.chain)
    await service.accept({ order: first, signature: await sign(first) })
    const next = await service.accept({ order: second, signature: await sign(second) })
    const simulated: string[] = []
    env.chain.simulate = async value => { simulated.push(value.nonce); if (value.nonce === '1') throw new ChainFailure('price'); return 1n }
    let signed = 0
    const signer = { address: executor.address, async signTransaction(plan: Parameters<typeof executor.signTransaction>[0]) { signed++; return executor.signTransaction(plan) } }
    const limits = { maxOrders: 1, maxRecoveries: 1, stopAfterRecovery: true }
    await new OrdersKeeper(env.config, env.store, env.chain, signer).runOnce(limits)
    expect(simulated).toEqual(['1']); expect(signed).toBe(0)
    env.store.close()
    const reopened = new OrderStore(env.path)
    try {
      await new OrdersKeeper(env.config, reopened, env.chain, signer).runOnce(limits)
      expect(simulated).toEqual(['1', '2']); expect(signed).toBe(1)
      expect(reopened.executions()[0].orderId).toBe(next.order.id)
      await expect(new OrdersKeeper(env.config, reopened, env.chain, signer).runOnce({ maxOrders: 17 })).rejects.toThrow('bounds')
    } finally { reopened.close() }
  })
  it('awaits the storage durability barrier before handing saved raw bytes to the network', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    const value = order(), service = new OrdersService(env.config, env.store, env.chain)
    await service.accept({ order: value, signature: await sign(value) })
    let release: (() => void) | undefined, calls = 0
    env.store.driver.sync = () => ++calls === 1 ? new Promise<void>(resolve => { release = resolve }) : Promise.resolve()
    const running = new OrdersKeeper(env.config, env.store, env.chain, { address: executor.address, signTransaction: plan => executor.signTransaction(plan) }).runOnce()
    for (let tries = 0; tries < 100; tries++) { if (release) break; await new Promise<void>(resolve => setImmediate(resolve)) }
    expect(release).toBeDefined(); expect(env.store.executions()).toHaveLength(1); expect(env.chain.broadcasts).toHaveLength(0)
    release!(); await running
    expect(env.chain.broadcasts).toHaveLength(1)
  })
})
