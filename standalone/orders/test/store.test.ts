import { chmodSync, lstatSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { orderId } from '../src/chain.ts'
import { NonceConflict, OrderStore } from '../src/store.ts'
import { environment, order, sign } from './fixture.ts'
const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()))
describe('isolated durable order store', () => {
  it('persists across restart, is private, and makes same order idempotent without replacing terminal state', async () => {
    const env = environment(); cleanups.push(env.cleanup)
    const value = order(), signature = await sign(value), observed = (await env.chain.observe()).observation
    const first = env.store.insert(orderId(value), value, signature, observed, 1000)
    expect(first.created).toBe(true)
    env.store.update(first.order.id, { status: 'cancelled', observation: observed }, 1001)
    expect(env.store.insert(first.order.id, value, signature, observed, 1002).order.status).toBe('cancelled')
    env.store.close()
    const reopened = new OrderStore(env.path)
    expect(reopened.get(first.order.id)?.status).toBe('cancelled')
    expect(lstatSync(env.path).mode & 0o777).toBe(0o600)
    expect(JSON.stringify(reopened.get(first.order.id)).includes(signature)).toBe(false)
    reopened.close()
  })
  it('rejects conflicting payloads at the same maker nonce and paginates only that maker', async () => {
    const env = environment(); cleanups.push(env.cleanup)
    const value = order(), observed = (await env.chain.observe()).observation
    env.store.insert(orderId(value), value, await sign(value), observed, 1000)
    const changed = { ...value, minAmountOut: '2' }
    expect(() => env.store.insert(orderId(changed), changed, '0x01', observed, 1001)).toThrow(NonceConflict)
    const next = order('2'); env.store.insert(orderId(next), next, await sign(next), observed, 1002)
    const page = env.store.list(value.maker, 1)
    expect(page.orders[0].order.nonce).toBe('2')
    expect(env.store.list(value.maker, 1, page.nextCursor!).orders[0].order.nonce).toBe('1')
    expect(env.store.list('0x2222222222222222222222222222222222222222', 100).orders).toEqual([])
  })
  it('fails closed on a foreign database or insecure mode rather than touching other application tables', () => {
    const env = environment(); cleanups.push(env.cleanup); env.store.close()
    const db = new DatabaseSync(env.path); db.exec('PRAGMA application_id=123;CREATE TABLE foreign_data(value TEXT);INSERT INTO foreign_data VALUES(\'retained\')'); db.close()
    expect(() => new OrderStore(env.path)).toThrow('not owned')
    const probe = new DatabaseSync(env.path, { readOnly: true }); expect(probe.prepare('SELECT value FROM foreign_data').get()).toMatchObject({ value: 'retained' }); probe.close()
    chmodSync(env.path, 0o644)
    expect(() => new OrderStore(env.path)).toThrow('0600')
  })
  it('permits only one keeper owner for a live process and releases it explicitly', () => {
    const env = environment(); cleanups.push(env.cleanup)
    expect(env.store.acquire('a')).toBe(true)
    expect(env.store.acquire('b')).toBe(false)
    env.store.release('wrong')
    expect(env.store.acquire('b')).toBe(false)
    env.store.release('a')
    expect(env.store.acquire('b')).toBe(true)
    env.store.release('b')
  })
})
