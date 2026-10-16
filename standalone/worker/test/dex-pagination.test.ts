import { describe, expect, it, vi } from 'vitest'
import { encodeAbiParameters, parseAbiParameters, toEventSelector } from 'viem'
import { dexApi } from '../src/dex-api'
import { deployment, EVENTS, FIRST_BLOCK } from '../src/contracts'
import { fixture, hash, hex, memoryStore, request, swap } from './dex-fixtures'
const createdPool = '0x4444444444444444444444444444444444444444'
function created(): object {
  const token0 = '0x2222222222222222222222222222222222222222'
  const token1 = '0x3333333333333333333333333333333333333333'
  return { address: deployment.contracts.v3Factory, blockNumber: hex(FIRST_BLOCK + 50), blockHash: hash('a'), transactionHash: hash('e'), logIndex: '0x0', topics: [toEventSelector(EVENTS[0]), `0x${token0.slice(2).padStart(64, '0')}`, `0x${token1.slice(2).padStart(64, '0')}`, `0x${'64'.padStart(64, '0')}`], data: encodeAbiParameters(parseAbiParameters('int24,address'), [1, createdPool]) }
}
interface PoolResponse { pools: { id: string }[]; nextCursor: string | null; coverage: { fromBlock: number; toBlock: number }; discoveryComplete: boolean; asOf: { number: number } }
interface EventResponse { events: { id: string; address: string }[]; nextCursor: string | null; phase: string }
describe('complete bounded discovery and reorganization-safe cursors', () => {
  it('retains old self-created pools through complete paginated factory discovery', async () => {
    const store = memoryStore(), upstream = fixture([created()])
    const first = await (await dexApi(request('pools'), upstream, store)).json() as PoolResponse
    expect(first.pools.some((pool) => pool.id === createdPool)).toBe(true)
    expect(first.coverage.fromBlock).toBe(FIRST_BLOCK)
    expect(first.discoveryComplete).toBe(false)
    const ids = new Set(first.pools.map((pool) => pool.id))
    let page = first
    let pages = 1
    while (page.nextCursor) {
      page = await (await dexApi(request(`pools?cursor=${page.nextCursor}`), upstream, store)).json() as PoolResponse
      page.pools.forEach((pool) => ids.add(pool.id))
      expect(page.asOf).toEqual(first.asOf)
      pages++
    }
    expect(pages).toBe(3)
    expect(page.discoveryComplete).toBe(true)
    expect(ids.has(createdPool)).toBe(true)
    expect(ids.size).toBe(3)
  })
  it('finds a new V3 pool created before the queried history interval and includes its swaps', async () => {
    const recent = { ...swap(), address: createdPool, blockNumber: hex(FIRST_BLOCK + 3005) }
    const response = await dexApi(request(`events?fromBlock=${FIRST_BLOCK + 3000}&toBlock=${FIRST_BLOCK + 3100}`), fixture([created(), recent]), memoryStore())
    expect(response.status).toBe(200)
    const value = await response.json() as EventResponse
    expect(value.events).toHaveLength(1)
    expect(value.events[0].address).toBe(createdPool)
    expect(value.nextCursor).toBeNull()
  })
  it('rejects an old offset after a reorganization; restarting returns all 21 replacement events', async () => {
    const store = memoryStore(), url = `events?fromBlock=${FIRST_BLOCK}&toBlock=${FIRST_BLOCK + 100}`
    const old = await (await dexApi(request(url), fixture(Array.from({ length: 21 }, (_, index) => swap(index))), store)).json() as EventResponse
    expect(old.events).toHaveLength(20)
    const replacements = Array.from({ length: 21 }, (_, index) => swap(index, hash('d')))
    const reorganized = fixture(replacements, hash('f'))
    const conflict = await dexApi(request(`${url}&cursor=${old.nextCursor}`), reorganized, store)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ error: 'Chain reorganized; restart range', code: 'CHAIN_REORGANIZED', restartFromBlock: FIRST_BLOCK })
    expect(reorganized.mock.calls.map(([, options]) => JSON.parse(String(options?.body)) as { method: string }).some((body) => body.method === 'eth_getLogs')).toBe(false)
    const first = await (await dexApi(request(url), reorganized, store)).json() as EventResponse
    const last = await (await dexApi(request(`${url}&cursor=${first.nextCursor}`), reorganized, store)).json() as EventResponse
    expect(new Set([...first.events, ...last.events].map((event) => event.id)).size).toBe(21)
    expect(first.events.every((event) => !old.events.some((previous) => previous.id === event.id))).toBe(true)
  })
  it('continues discovery across requests without claiming empty history when the subrequest budget is reached', async () => {
    const store = memoryStore(), current = FIRST_BLOCK + 20000
    const recent = { ...swap(), address: createdPool, blockNumber: hex(FIRST_BLOCK + 19005) }
    const upstream = fixture([created(), recent], hash('c'), current)
    const url = `events?fromBlock=${FIRST_BLOCK + 19000}`
    const first = await (await dexApi(request(url), upstream, store)).json() as EventResponse
    expect(first.phase).toBe('discovery')
    expect(first.events).toEqual([])
    expect(first.nextCursor).toEqual(expect.any(String))
    const page = await (await dexApi(request(`${url}&cursor=${first.nextCursor}`), upstream, store)).json() as EventResponse
    expect(page.phase).toBe('events')
    expect(page.events).toHaveLength(1)
    expect(page.events[0].address).toBe(createdPool)
    expect(page.nextCursor).toBeNull()
  })

  it('treats a vanished anchor block as a reorganization rather than replaying a cached offset', async () => {
    const store = memoryStore(), url = `events?fromBlock=${FIRST_BLOCK + 3000}&toBlock=${FIRST_BLOCK + 3100}`
    const upstream = fixture(Array.from({ length: 21 }, (_, index) => ({ ...swap(index), blockNumber: hex(FIRST_BLOCK + 3005) })))
    const first = await (await dexApi(request(url), upstream, store)).json() as EventResponse
    const shortened = vi.fn<typeof fetch>().mockImplementation(async (requestUrl, options) => {
      const body = JSON.parse(String(options?.body)) as { id: number; method: string; params: unknown[] }
      if (body.method === 'eth_getBlockByNumber') return Response.json({ jsonrpc: '2.0', id: body.id, result: body.params[0] === 'latest' ? { number: hex(FIRST_BLOCK + 1000), hash: hash('f'), timestamp: '0x68000000' } : null })
      return upstream(requestUrl, options)
    })
    const response = await dexApi(request(`${url}&cursor=${first.nextCursor}`), shortened, store)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'CHAIN_REORGANIZED' })
  })
  it('returns a restart instruction for expired or query-substituted cursors', async () => {
    const store = memoryStore()
    const expired = await dexApi(request('events?cursor=missing'), fixture(), store)
    expect(expired.status).toBe(409)
    expect(await expired.json()).toMatchObject({ code: 'CURSOR_EXPIRED', restartFromBlock: FIRST_BLOCK })
    const first = await (await dexApi(request('pools'), fixture(), store)).json() as PoolResponse
    expect((await dexApi(request(`pools?cursor=${first.nextCursor}&fromBlock=${FIRST_BLOCK + 1}`), fixture(), store)).status).toBe(409)
  })
})
