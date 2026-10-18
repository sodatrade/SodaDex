import { decodeEventLog, toEventSelector } from 'viem'
import { EVENTS, record, same, ZERO } from '../contracts'
import { head, hex, logs, type Block, type ChainLog, type Pool } from '../dex-data'
import { blockAt, MissingAnchorBlock } from '../cursors'
import { rpc } from '../upstream'
import type { IndexStore } from './store'
import type { IndexConfig, IndexedEvent, IndexSource } from './types'
const READ_METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_getTransactionByHash'])
/** This boundary cannot sign, simulate or submit a transaction. A hard RPC ceiling applies to each alarm. */
export function indexFetch(config: IndexConfig, upstream: typeof fetch = fetch): typeof fetch {
  let requests = 0
  return async (_input, options) => {
    const body: unknown = JSON.parse(String(options?.body))
    if (!record(body) || !READ_METHODS.has(String(body.method)) || ++requests > 40) throw Error('Index RPC budget exhausted')
    const response = await upstream(config.profile.rpcUrl, { ...options, redirect: 'manual' })
    if (body.method === 'eth_getLogs' && response.ok) {
      const data: unknown = await response.clone().json()
      if (record(data) && Array.isArray(data.result)) {
        const seen = new Map<string, string>()
        for (const log of data.result) if (record(log)) {
          const key = `${log.blockHash}:${log.logIndex}`.toLowerCase(), value = JSON.stringify(log).toLowerCase()
          if (seen.has(key) && seen.get(key) !== value) throw Error('Conflicting event identity')
          seen.set(key, value)
        }
      }
    }
    return response
  }
}
function poolFrom(log: ChainLog, decoded: { eventName: string; args: Record<string, unknown> }): Pool | null {
  const a = decoded.args, v3 = decoded.eventName === 'PoolCreated'
  if (!v3 && decoded.eventName !== 'Initialize') return null
  return { protocol: v3 ? 'v3' : 'v4', id: String(v3 ? a.pool : a.id).toLowerCase(), address: v3 ? String(a.pool) : null,
    token0: String(v3 ? a.token0 : a.currency0), token1: String(v3 ? a.token1 : a.currency1), fee: Number(a.fee), tickSpacing: Number(a.tickSpacing), hooks: v3 ? ZERO : String(a.hooks),
    createdBlock: Number(BigInt(log.blockNumber)), source: 'chain', sqrtPriceX96: null, tick: null, liquidity: null, stateError: null }
}
function decode(log: ChainLog, source: IndexSource): { eventName: string; args: Record<string, unknown> } {
  const event = decodeEventLog({ abi: source.abi, data: log.data, topics: log.topics, strict: true })
  return { eventName: String(event.eventName), args: event.args as unknown as Record<string, unknown> }
}
export async function verifyIndex(store: IndexStore, read: typeof fetch): Promise<boolean> {
  const anchor = store.anchor()
  if (anchor) {
    try { if (!same((await blockAt(anchor.number, read)).hash, anchor.hash)) { store.rollback(); return false } }
    catch (error) { if (error instanceof MissingAnchorBlock) { store.rollback(); return false }; throw error }
  }
  return true
}
export async function scanOnce(store: IndexStore, config: IndexConfig, upstream: typeof fetch = fetch): Promise<void> {
  const read = indexFetch(config, upstream)
  if (await rpc('eth_chainId', [], read) !== config.profile.chainHex) throw Error('Index RPC wrong chain')
  if (!await verifyIndex(store, read)) return
  const previousAnchor = store.anchor()
  const latest = await head(read), state = store.status()
  if (state.indexedThrough >= latest.number) { store.save({ ...state, head: latest, syncing: false, lastError: null }); return }
  const sources = [...config.sources]
  if (config.profile.chainId === 196) for (const pool of store.pools(state.indexedThrough))
    if (pool.address && !sources.some(s => same(s.address, pool.address!))) sources.push({ address: pool.address, abi: EVENTS, protocol: 'v3', role: 'pool' })
  const topics = [...new Set(sources.flatMap(s => s.abi.filter(item => item.type === 'event').map(item => toEventSelector(item))))]
  const from = state.indexedThrough + 1
  let to = Math.min(latest.number, from + 1999), result: ChainLog[] = [], derived: Pool[] = []
  // Dense intervals shrink before checkpointing, keeping block and transaction verification bounded.
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const windows = config.profile.chainId === 1952 ? Array.from({ length: Math.ceil((to - from + 1) / 100) }, (_, i) => ({ from: from + i * 100, to: Math.min(to, from + i * 100 + 99) })) : [{ from, to }]
      result = (await Promise.all(windows.map(range => logs(sources.map(s => s.address), range.from, range.to, [topics], read)))).flat().filter(log => sources.find(s => same(s.address, log.address))!.abi.some(item => item.type === 'event' && same(toEventSelector(item), log.topics[0])))
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Log page unavailable;') && to > from && attempt < 11) { to = from + Math.floor((to - from) / 2); continue }
      throw error
    }
    derived = config.profile.chainId === 196 ? result.flatMap(log => { const pool = poolFrom(log, decode(log, sources.find(s => same(s.address, log.address))!)); return pool ? [pool] : [] }) : []
    const added = derived.filter(p => p.address && !sources.some(s => same(s.address, p.address!)))
    if (added.length) {
      result.push(...await logs(added.map(p => p.address!), from, to, [EVENTS.map(e => toEventSelector(e))], read))
      for (const p of added) sources.push({ address: p.address!, abi: EVENTS, protocol: 'v3', role: 'pool' })
    }
    const eventBlocks = [...new Set(result.map(log => Number(BigInt(log.blockNumber))))]
    // oxlint-disable-next-line unicorn/no-array-sort -- Sort a newly allocated numeric block list.
    eventBlocks.sort((a, b) => a - b)
    if (eventBlocks.length > 12) {
      to = eventBlocks[12] - 1
      result = result.filter(log => Number(BigInt(log.blockNumber)) <= to)
      derived = derived.filter(pool => (pool.createdBlock ?? from) <= to)
    }
    break
  }
  const end = await blockAt(to, read), headers = new Map<number, Block>([[to, end]]), senders = new Map<string, string>()
  await Promise.all([...new Set(result.map(log => Number(BigInt(log.blockNumber))))].map(async number => {
    const block = await rpc('eth_getBlockByNumber', [hex(number), true], read)
    if (!record(block) || block.number !== hex(number) || typeof block.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(block.hash) || typeof block.timestamp !== 'string' || !/^0x[0-9a-fA-F]+$/.test(block.timestamp) || !Array.isArray(block.transactions)) throw Error('Index block unavailable')
    const timestamp = Number(BigInt(block.timestamp))
    if (!Number.isSafeInteger(timestamp)) throw Error('Invalid index timestamp')
    headers.set(number, { number, hash: block.hash, timestamp })
    for (const log of result.filter(item => Number(BigInt(item.blockNumber)) === number)) {
      const tx = block.transactions.find(item => record(item) && same(String(item.hash), log.transactionHash))
      if (!record(tx) || typeof tx.from !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(tx.from) || !same(String(tx.blockHash), log.blockHash) || !same(log.blockHash, block.hash)) throw Error('Index transaction mismatch')
      senders.set(log.transactionHash, tx.from.toLowerCase())
    }
  }))
  const events: IndexedEvent[] = result.map(log => {
    const source = sources.find(s => same(s.address, log.address))!, decoded = decode(log, source), block = headers.get(Number(BigInt(log.blockNumber)))!
    if (!same(block.hash, log.blockHash)) throw Error('Index event is not canonical')
    const args: IndexedEvent['args'] = {}
    for (const [key, value] of Object.entries(decoded.args)) if (typeof value === 'bigint') args[key] = String(value); else if (['string', 'number', 'boolean'].includes(typeof value)) args[key] = value as string | number | boolean
    return { id: `${log.blockHash.toLowerCase()}:${Number(BigInt(log.logIndex))}`, protocol: source.protocol, address: log.address.toLowerCase(), event: decoded.eventName,
      blockNumber: block.number, blockHash: block.hash, transactionHash: log.transactionHash.toLowerCase(), logIndex: Number(BigInt(log.logIndex)), args, transactionFrom: senders.get(log.transactionHash)!, timestamp: block.timestamp }
  })
  if (!same((await blockAt(to, read)).hash, end.hash)) throw Error('Index interval changed during scan')
  if (previousAnchor && !await verifyIndex(store, read)) return
  store.commit({ from, to: end, head: latest, logs: result, events, pools: derived })
}
