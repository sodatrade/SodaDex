import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { createOrdersServer } from '../src/server.ts'
import { OrdersService } from '../src/service.ts'
import { environment, order, sign } from './fixture.ts'
const cleanups: (() => void)[] = [], servers: Server[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); cleanups.splice(0).forEach(cleanup => cleanup()) })
async function start(): Promise<{ base: string; env: ReturnType<typeof environment> }> {
  const env = environment(true); cleanups.push(env.cleanup)
  const server = createOrdersServer(new OrdersService(env.config, env.store, env.chain)); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('Test listener failed')
  return { base: `http://127.0.0.1:${address.port}`, env }
}
describe('public order API', () => {
  it('submits and reads public metadata without ever exposing signatures or raw signed transactions', async () => {
    const { base } = await start(), value = order(), signature = await sign(value)
    const created = await fetch(base + '/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: value, signature }) })
    expect(created.status).toBe(201)
    const payload = await created.json() as { order: { id: string } }
    const single = await fetch(base + '/v1/orders/' + payload.order.id), list = await fetch(base + '/v1/orders?maker=' + value.maker)
    const text = await single.text() + await list.text()
    expect(text.includes(signature)).toBe(false)
    expect(text.includes('rawTransaction')).toBe(false)
    expect(text.includes('signature')).toBe(false)
    expect((await fetch(base + '/v1/orders/' + payload.order.id, { method: 'DELETE' })).status).toBe(405)
  })
  it('enforces explicit CORS origin, strict JSON body/size and read query constraints', async () => {
    const { base } = await start()
    expect((await fetch(base + '/v1/status', { headers: { Origin: 'https://attacker.example' } })).status).toBe(403)
    const allowed = await fetch(base + '/v1/status', { headers: { Origin: 'http://127.0.0.1:3031' } })
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:3031')
    expect((await fetch(base + '/v1/orders', { method: 'POST', body: 'x' })).status).toBe(415)
    expect((await fetch(base + '/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json-unsupported' }, body: '{}' })).status).toBe(415)
    expect((await fetch(base + '/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ padding: 'x'.repeat(17000) }) })).status).toBe(413)
    expect((await fetch(base + '/v1/orders?maker=bad')).status).toBe(400)
    expect((await fetch(base + '/v1/orders?maker=' + order().maker + '&rpc=https://attacker.example')).status).toBe(400)
    expect((await fetch(base + '/v1/orders?maker=' + order().maker + '&maker=' + order().maker)).status).toBe(400)
  })
  it('refreshes terminal rows during maker-list polling so reorged cancellations regain their cancellation entry', async () => {
    const { base, env } = await start(), value = order(), signature = await sign(value)
    const created = await (await fetch(base + '/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: value, signature }) })).json() as { order: { id: string } }
    env.chain.status = 1
    const cancelled = await (await fetch(base + '/v1/orders?maker=' + value.maker)).json() as { orders: { status: string }[] }
    expect(cancelled.orders[0].status).toBe('cancelled')
    env.chain.status = 0; env.chain.previousCanonical = false
    const restored = await (await fetch(base + '/v1/orders?maker=' + value.maker)).json() as { orders: { id: string; status: string; reason: string | null }[] }
    expect(restored.orders[0]).toMatchObject({ id: created.order.id, status: 'open', reason: null })
  })
})
