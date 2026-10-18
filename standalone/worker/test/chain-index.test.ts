import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type Hex } from 'viem'
import { IndexStore } from '../src/chain-index/store'
import { baseConfig } from '../src/chain-index/config'
import { indexPage, IndexRestart } from '../src/chain-index/api'
import { indexFetch, scanOnce, verifyIndex } from '../src/chain-index/scan'
import { chainIndexApi } from '../src/chain-index/durable'
import { EVENTS, pools } from '../src/contracts'
import { hex, type Block } from '../src/dex-data'
import type { Storage, IndexedEvent } from '../src/chain-index/types'
const unavailable: typeof fetch = async () => new Response('unavailable', { status: 502 })
const vanished: typeof fetch = async () => Response.json({ jsonrpc: '2.0', id: 1, result: null })
const address = `0x${'11'.repeat(20)}`, other = `0x${'22'.repeat(20)}`
const hash = (number: number): Hex => `0x${number.toString(16).padStart(64, '0')}`
function fixture(count = 23) {
  const db = new DatabaseSync(':memory:')
  const storage: Storage = { sql: { exec(sql, ...args) { if (!args.length && sql.includes(';')) { db.exec(sql); return { toArray: () => [] } }; const rows = db.prepare(sql).all(...args); return { toArray: () => rows as ReturnType<Storage['sql']['exec']> extends { toArray(): infer R } ? R : never } } },
    transactionSync(op) { db.exec('BEGIN'); try { const value = op(); db.exec('COMMIT'); return value } catch (error) { db.exec('ROLLBACK'); throw error } }, getAlarm: async () => null, setAlarm: async () => {} }
  const config = baseConfig('196-test'); config.fromBlock = 100
  const store = new IndexStore(storage, config), block: Block = { number: 110, hash: hash(110), timestamp: 1000 }
  const events: IndexedEvent[] = Array.from({ length: count }, (_, i) => ({ id: `${block.hash}:${i}`, protocol: 'v3', address: pools.v3.address.toLowerCase(), event: 'Swap', blockNumber: 110, blockHash: block.hash, transactionHash: hash(1000 + i), logIndex: i, args: { recipient: other, amount0: String(i) }, transactionFrom: address, timestamp: 1000 }))
  const raw = events.map(e => ({ address: e.address, topics: encodeEventTopics({ abi: EVENTS, eventName: 'Swap', args: { sender: address as Hex, recipient: other as Hex } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(parseAbiParameters('int256,int256,uint160,uint128,int24'), [1n, -1n, 1n, 1n, 0]), blockNumber: hex(110), blockHash: block.hash as Hex, transactionHash: e.transactionHash as Hex, logIndex: hex(e.logIndex) }))
  const read: typeof fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body)), number = body.params[0] === 'latest' ? block.number : body.method === 'eth_getBlockByNumber' ? Number(BigInt(body.params[0])) : 0
    const result = body.method === 'eth_chainId' ? '0xc4' : body.method === 'eth_getLogs' ? raw : { number: hex(number), hash: hash(number), timestamp: hex(1000), transactions: raw.map(log => ({ hash: log.transactionHash, blockHash: log.blockHash, from: address })) }
    return Response.json({ jsonrpc: '2.0', id: 1, result })
  }
  const commit = () => store.commit({ from: 100, to: block, head: block, events, logs: raw, pools: [] })
  return { db, store, config, storage, block, events, raw, read, commit }
}
describe('persistent chain index', () => {
  it('bounds pages at 10, binds filters, preserves snapshot when later rows arrive', async () => {
    const f = fixture(); f.commit()
    const first = await indexPage(new URL('https://index/events?owner=' + address), f.store, f.config, f.read) as { events: IndexedEvent[]; nextCursor: string }
    expect(first.events).toHaveLength(10); expect(first.events[0].logIndex).toBe(22)
    f.store.commit({ from: 111, to: { ...f.block, number: 111, hash: hash(111) }, head: { ...f.block, number: 111, hash: hash(111) }, events: [], logs: [], pools: [] })
    const second = await indexPage(new URL('https://index/events?owner=' + address + '&cursor=' + first.nextCursor), f.store, f.config, f.read) as { events: IndexedEvent[]; nextCursor: string }
    expect(second.events).toHaveLength(10); expect(second.events[0].logIndex).toBe(12)
    await expect(indexPage(new URL('https://index/events?owner=' + other + '&cursor=' + first.nextCursor), f.store, f.config, f.read)).rejects.toThrow(IndexRestart)
    await expect(indexPage(new URL('https://index/events?limit=11'), f.store, f.config, f.read)).rejects.toThrow('Page size')
  })
  it('never advances over a missing interval and rolls back all rows on identity conflicts', () => {
    const f = fixture(1)
    expect(() => f.store.commit({ from: 101, to: f.block, head: f.block, events: f.events, logs: f.raw, pools: [] })).toThrow('Noncontiguous')
    f.events.push({ ...f.events[0], event: 'Changed' }); f.raw.push(f.raw[0])
    expect(f.commit).toThrow('Conflicting'); expect(f.store.query('SELECT * FROM index_events')).toHaveLength(0)
    expect(f.store.status().indexedThrough).toBe(99)
  })
  it('deduplicates equivalent identities, survives reconstruction and invalidates reorg cursors', async () => {
    const f = fixture(1); f.events.push(f.events[0]); f.raw.push(f.raw[0]); f.commit()
    const next = new IndexStore(f.storage, f.config)
    expect(next.query('SELECT * FROM index_events')).toHaveLength(1); expect(next.status().indexedThrough).toBe(110)
    const wrong: typeof fetch = async () => Response.json({ jsonrpc: '2.0', id: 1, result: { number: hex(110), hash: hash(999), timestamp: '0x1' } })
    expect(await verifyIndex(next, wrong)).toBe(false); expect(next.status().indexedThrough).toBe(99); expect(next.status().generation).toBe(1)
    expect(next.query('SELECT * FROM index_events')).toHaveLength(0)
  })
  it('rolls back a vanished anchor without mistaking an RPC outage for a reorg', async () => {
    const f = fixture(1); f.commit()
    await expect(verifyIndex(f.store, unavailable)).rejects.toThrow(); expect(f.store.status().indexedThrough).toBe(110)
    expect(await verifyIndex(f.store, vanished)).toBe(false); expect(f.store.status().indexedThrough).toBe(99)
  })
  it('rechecks the previous checkpoint before committing a range fetched across a reorg', async () => {
    const f = fixture(1); f.commit(); let anchorChecks = 0
    const changing: typeof fetch = async (input, options) => {
      const body = JSON.parse(String(options?.body))
      if (body.method === 'eth_getBlockByNumber') {
        const latest = body.params[0] === 'latest', number = latest ? 111 : Number(BigInt(body.params[0]))
        if (number === 110) anchorChecks++
        return Response.json({ jsonrpc: '2.0', id: 1, result: { number: hex(number), hash: hash(number === 110 && anchorChecks > 1 ? 999 : number), timestamp: '0x3e8', transactions: [] } })
      }
      if (body.method === 'eth_getLogs') return Response.json({ jsonrpc: '2.0', id: 1, result: [] })
      return f.read(input, options)
    }
    await scanOnce(f.store, f.config, changing)
    expect(f.store.status().indexedThrough).toBe(99); expect(f.store.query('SELECT * FROM index_events')).toHaveLength(0)
  })
  it('supports recipients and event filters and distinguishes incomplete empty from complete empty', async () => {
    const f = fixture(1)
    const empty = await indexPage(new URL('https://index/events'), f.store, f.config, f.read) as { coverage: { complete: boolean }; index: { syncing: boolean } }
    expect(empty.coverage.complete).toBe(false); expect(empty.index.syncing).toBe(true)
    f.commit()
    const found = await indexPage(new URL('https://index/events?owner=' + other + '&event=Swap'), f.store, f.config, f.read) as { events: IndexedEvent[] }
    expect(found.events).toHaveLength(1)
  })
  it('scans canonical logs with a bounded read-only RPC set and rejects conflicting duplicates', async () => {
    const f = fixture(23); await scanOnce(f.store, f.config, f.read)
    expect(f.store.status().syncing).toBe(false); expect(f.store.query('SELECT * FROM index_events')).toHaveLength(23)
    const guarded = indexFetch(f.config, f.read)
    await expect(guarded('https://rpc.invalid', { body: JSON.stringify({ method: 'eth_sendRawTransaction' }) })).rejects.toThrow('budget')
    const conflicting: typeof fetch = async () => Response.json({ jsonrpc: '2.0', id: 1, result: [f.raw[0], { ...f.raw[0], data: '0xab' }] })
    await expect(indexFetch(f.config, conflicting)('https://rpc.invalid', { body: JSON.stringify({ method: 'eth_getLogs' }) })).rejects.toThrow('Conflicting')
  })
  it('indexes a newly created v3 pool and its first same-block swap in one checkpoint', async () => {
    const f = fixture(1), factory = f.config.sources.find(source => source.role === 'factory')!, pool = `0x${'33'.repeat(20)}`
    const created = { ...f.raw[0], address: factory.address, topics: encodeEventTopics({ abi: EVENTS, eventName: 'PoolCreated', args: { token0: address as Hex, token1: other as Hex, fee: 100 } }),
      data: encodeAbiParameters(parseAbiParameters('int24,address'), [1, pool as Hex]), logIndex: hex(0) }
    const swap = { ...f.raw[0], address: pool, logIndex: hex(1) }
    const reader: typeof fetch = async (input, options) => {
      const body = JSON.parse(String(options?.body))
      if (body.method === 'eth_getLogs') {
        const requested = [body.params[0].address].flat().map((a: string) => a.toLowerCase())
        return Response.json({ jsonrpc: '2.0', id: 1, result: [created, swap].filter(log => requested.includes(log.address.toLowerCase())) })
      }
      return f.read(input, options)
    }
    await scanOnce(f.store, f.config, reader)
    expect(f.store.pools(110)[0].address?.toLowerCase()).toBe(pool)
    expect(f.store.query('SELECT event FROM index_events').map(row => row.event)).toEqual(['PoolCreated', 'Swap'])
  })
  it('separates 1952 ERC20 values from NFT token IDs by emitting source ABI', () => {
    const config = baseConfig('1952-mining-test'), erc20 = config.sources.find(s => s.role === 'fab')!, nft = config.sources.find(s => s.role === 'circuits')!
    expect(erc20.abi).not.toEqual(nft.abi)
    const wrong = { ...fixture().config, profile: config.profile }
    const f = fixture(); expect(() => new IndexStore(f.storage, wrong)).toThrow('identity')
  })
  it('routes fixed profile actors and denies cross origin, writes and oversized filters', async () => {
    const names: string[] = []
    const env = { CHAIN_INDEX: { idFromName(name: string) { names.push(name); return name }, get() { return { fetch: async () => Response.json({ ok: true }) } } } }
    await chainIndexApi(new Request('https://site/api/index/status'), env, '196-test')
    await chainIndexApi(new Request('https://site/api/index/status'), env, '1952-mining-test')
    expect(names[0]).not.toBe(names[1])
    expect((await chainIndexApi(new Request('https://site/api/index/status', { method: 'POST' }), env, '196-test')).status).toBe(405)
    expect((await chainIndexApi(new Request('https://site/api/index/status', { headers: { Origin: 'https://other' } }), env, '196-test')).status).toBe(403)
  })
})
