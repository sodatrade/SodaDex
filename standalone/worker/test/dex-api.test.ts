import { describe, expect, it, vi } from 'vitest'
import { toEventSelector } from 'viem'
import { dexApi } from '../src/dex-api'
import { deployment, EVENTS, FIRST_BLOCK, pools } from '../src/contracts'
import { validLogFilter } from '../src/logs'
import { at, fixture, hash, hex, memoryStore, request, swap } from './dex-fixtures'
describe('real-source DEX API', () => {
  it('returns both live pool snapshots pinned to one canonical block and explicit discovery coverage', async () => {
    const upstream = fixture()
    const response = await dexApi(request('pools'), upstream, memoryStore())
    expect(response.status).toBe(200)
    const value = await response.json() as { asOf: { number: number }; pools: { sqrtPriceX96: string; liquidity: string }[]; coverage: { complete: boolean; fromBlock: number } }
    expect(value.asOf.number).toBe(at)
    expect(value.pools).toHaveLength(2)
    expect(value.pools.every((pool) => pool.liquidity === '25' && pool.sqrtPriceX96 === String(2n ** 96n))).toBe(true)
    expect(value.coverage).toEqual({ fromBlock: FIRST_BLOCK, toBlock: FIRST_BLOCK + 1999, complete: false, nextFromBlock: FIRST_BLOCK + 2000 })
    const reads = upstream.mock.calls.map(([, options]) => JSON.parse(String(options?.body)) as { method: string; params: unknown[] }).filter((body) => body.method === 'eth_call')
    expect(reads.every((body) => body.params[1] === hex(at))).toBe(true)
  })
  it('paginates events deterministically, deduplicates replay and exposes block-hash identity for reorganizations', async () => {
    const items = Array.from({ length: 21 }, (_, index) => swap(index))
    const url = `events?fromBlock=${FIRST_BLOCK}&toBlock=${FIRST_BLOCK + 100}`
    const store = memoryStore()
    const response = await dexApi(request(url), fixture([...items, items[0]]), store)
    const first = await response.json() as { events: { id: string }[]; nextCursor: string }
    expect(first.events).toHaveLength(20)
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = await (await dexApi(request(`${url}&cursor=${first.nextCursor}`), fixture(items), store)).json() as { events: { id: string }[]; nextCursor: null }
    expect(second.events).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
    expect(second.events[0].id).not.toBe(first.events[0].id)
    const replay = await (await dexApi(request(url), fixture(items), memoryStore())).json() as { events: { id: string }[] }
    expect(replay.events).toEqual(first.events)
    const reorg = await (await dexApi(request(url), fixture([swap(0, hash('d'))]), memoryStore())).json() as { events: { id: string }[] }
    expect(reorg.events[0].id).not.toBe(first.events[0].id)
  })
  it('filters owner activity by transaction sender without claiming complete lifetime history', async () => {
    const response = await dexApi(request(`events?owner=${deployment.owner}`), fixture([swap()]))
    const value = await response.json() as { events: { transactionFrom: string }[]; coverage: { nextFromBlock: number; complete: boolean } }
    expect(value.events[0].transactionFrom).toBe(deployment.owner)
    expect(value.coverage.nextFromBlock).toBe(FIRST_BLOCK + 2000)
    expect(value.coverage.complete).toBe(false)
  })
  it('reports actual raw volume and reserve balances with null USD TVL/APR and clearly estimated fees', async () => {
    const response = await dexApi(request(`market?pool=${pools.v3.address}&fromBlock=${FIRST_BLOCK}&toBlock=${FIRST_BLOCK + 100}`), fixture([swap()]))
    expect(response.status).toBe(200)
    const value = await response.json() as Record<string, unknown>
    expect(value.volume).toEqual({ token0Raw: '10000', token1Raw: '20' })
    expect(value.reserves).toEqual({ token0Raw: '50', token1Raw: '50', reason: null })
    expect(value.fees).toMatchObject({ token0Raw: '1', token1Raw: '0' })
    expect(value.priceToken1PerToken0).toBe('1')
    expect(value.priceHistory).toEqual([{ blockNumber: FIRST_BLOCK + 5, logIndex: 0, sqrtPriceX96: String(2n ** 96n) }])
    expect(value.tvlUsd).toBeNull()
    expect(value.apr).toBeNull()
  })
  it('rejects bad ranges/cursors/origins and propagates source failure as unavailable, never synthetic zero metrics', async () => {
    for (const path of ['events?fromBlock=0', 'events?owner=invalid', 'market?pool=bad']) expect((await dexApi(request(path), fixture(), memoryStore())).status).toBe(400)
    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(new Response('down', { status: 503 }))
    const response = await dexApi(request('market?pool=' + pools.v3.address), unavailable)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'Chain data temporarily unavailable' })
    const upstream = fixture()
    expect((await dexApi(new Request('https://soda.example/api/dex/pools', { headers: { Origin: 'https://evil.example' } }), upstream)).status).toBe(403)
    expect(upstream).not.toHaveBeenCalled()
  })
  it('rejects RPC log scans outside deployed addresses, supported topics and bounded deployment ranges', () => {
    const base = { address: deployment.contracts.v4PositionManager, fromBlock: hex(FIRST_BLOCK), toBlock: hex(FIRST_BLOCK + 1999), topics: [toEventSelector(EVENTS[4]), null, `0x${deployment.owner.slice(2).padStart(64, '0')}`] }
    expect(validLogFilter(base)).toBe(true)
    expect(validLogFilter({ ...base, toBlock: hex(FIRST_BLOCK + 2000) })).toBe(false)
    expect(validLogFilter({ ...base, fromBlock: '0x0' })).toBe(false)
    expect(validLogFilter({ ...base, address: deployment.owner })).toBe(false)
    expect(validLogFilter({ ...base, topics: [hash('e')] })).toBe(false)
    expect(validLogFilter({ ...base, blockHash: hash('f') })).toBe(false)
  })
})
