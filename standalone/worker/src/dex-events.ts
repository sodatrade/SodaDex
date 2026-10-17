import { toEventSelector, type Hex } from 'viem'
import { deployment, EVENTS, FIRST_BLOCK, MAX_EVENTS, PAGE_BLOCKS, pools, record, same } from './contracts'
import { BadRequest, coverage, integer, type Block, type ChainLog, type Coverage, decodeLog, logs } from './dex-data'
import { blockAt, loadCursor, queryKey, RestartScan, verifyAnchor, type CursorStore, type ScanCursor } from './cursors'
import { rpc, RpcUnavailable } from './upstream'
import { resolvePool } from './dex-market'
export interface DexEvent {
  id: string; protocol: 'v3' | 'v4'; address: string; event: string; blockNumber: number; blockHash: string; transactionHash: string; logIndex: number
  args: Record<string, string | number | boolean>; transactionFrom: string | null
}
interface EventCursor extends ScanCursor {
  kind: 'events'; discoveryNextBlock: number; v3Pools: string[]; addresses: string[]; addressOffset: number
  logs: ChainLog[]; offset: number; topics: (Hex | Hex[] | null)[]
}
const DISCOVERY_REQUESTS = 8
const ADDRESS_BATCH = 20
const SCAN_REQUESTS = 8
const MAX_BUFFERED_LOGS = 5000

async function initial(url: URL, asOf: Block, range: Coverage, upstreamFetch: typeof fetch): Promise<EventCursor> {
  const selected = url.searchParams.has('pool') ? await resolvePool(url, asOf, upstreamFetch) : null
  const topics: EventCursor['topics'] = selected?.protocol === 'v4' ? [[toEventSelector(EVENTS[1]), toEventSelector(EVENTS[3]), toEventSelector(EVENTS[8])], selected.id as Hex] : [EVENTS.map((event) => toEventSelector(event))]
  const anchor = range.toBlock === asOf.number ? asOf : await blockAt(range.toBlock, upstreamFetch)
  return { kind: 'events', query: queryKey(url), asOf, anchor, range, discoveryNextBlock: selected ? range.toBlock + 1 : FIRST_BLOCK, v3Pools: [pools.v3.address], addresses: selected ? [selected.address ?? deployment.contracts.v4PoolManager] : [], addressOffset: 0, logs: [], offset: 0, topics }
}
async function discoverPools(state: EventCursor, upstreamFetch: typeof fetch): Promise<void> {
  const known = new Set(state.v3Pools.map((address) => address.toLowerCase()))
  for (let count = 0; count < DISCOVERY_REQUESTS && state.discoveryNextBlock <= state.range.toBlock; count++) {
    const to = Math.min(state.range.toBlock, state.discoveryNextBlock + PAGE_BLOCKS - 1)
    const created = await logs([deployment.contracts.v3Factory], state.discoveryNextBlock, to, [toEventSelector(EVENTS[0])], upstreamFetch)
    for (const log of created) {
      const { args } = decodeLog(log)
      if (typeof args.pool !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(args.pool)) throw new RpcUnavailable('Invalid pool discovery event')
      if (!known.has(args.pool.toLowerCase())) { known.add(args.pool.toLowerCase()); state.v3Pools.push(args.pool) }
    }
    state.discoveryNextBlock = to + 1
  }
  if (state.discoveryNextBlock > state.range.toBlock && !state.addresses.length) state.addresses = [...new Map([deployment.contracts.v3Factory, deployment.contracts.v3PositionManager, deployment.contracts.v4PoolManager, deployment.contracts.v4PositionManager, ...state.v3Pools].map((address) => [address.toLowerCase(), address])).values()]
}
async function scanLogs(state: EventCursor, upstreamFetch: typeof fetch): Promise<void> {
  for (let count = 0; count < SCAN_REQUESTS && state.addressOffset < state.addresses.length; count++) {
    const batch = state.addresses.slice(state.addressOffset, state.addressOffset + ADDRESS_BATCH)
    state.logs.push(...await logs(batch, state.range.fromBlock, state.range.toBlock, state.topics, upstreamFetch))
    if (state.logs.length > MAX_BUFFERED_LOGS) throw new RpcUnavailable('Event page too dense; request a narrower block interval')
    state.addressOffset += batch.length
  }
}
function ordered(source: ChainLog[]): ChainLog[] {
  // oxlint-disable-next-line unicorn/no-array-sort -- The ES2022 target lacks toSorted; this sorts a fresh deduplicated array.
  return [...new Map(source.map((log) => [`${log.blockHash}:${log.logIndex}`, log])).values()].sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)))
}
async function pageEvents(source: ChainLog[], owner: string | null, state: EventCursor, upstreamFetch: typeof fetch): Promise<DexEvent[]> {
  const senders = new Map<string, string>()
  if (owner) {
    await Promise.all([...new Set(source.map((log) => log.transactionHash))].map(async (hash) => {
      const tx = await rpc('eth_getTransactionByHash', [hash], upstreamFetch)
      const expected = source.find((log) => same(log.transactionHash, hash))!.blockHash
      if (!record(tx) || typeof tx.from !== 'string' || !same(String(tx.hash), hash)) throw new RpcUnavailable('Transaction lookup unavailable')
      if (typeof tx.blockHash !== 'string' || !same(tx.blockHash, expected)) throw new RestartScan('CHAIN_REORGANIZED', state.range.fromBlock)
      senders.set(hash, tx.from)
    }))
  }
  const output: DexEvent[] = []
  for (const log of source) {
    let decoded: ReturnType<typeof decodeLog>
    try { decoded = decodeLog(log) } catch { throw new RpcUnavailable('Unsupported event result') }
    const sender = senders.get(log.transactionHash) ?? null
    if (owner && !((sender && same(owner, sender)) || (decoded.eventName === 'Transfer' && [decoded.args.from, decoded.args.to].some((address) => typeof address === 'string' && same(owner, address))))) continue
    const args: DexEvent['args'] = {}
    for (const [key, value] of Object.entries(decoded.args)) if (typeof value === 'bigint') args[key] = String(value); else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') args[key] = value
    output.push({ id: `${log.blockHash}:${Number(BigInt(log.logIndex))}`, protocol: [deployment.contracts.v4PoolManager, deployment.contracts.v4PositionManager].some((address) => same(address, log.address)) ? 'v4' : 'v3', address: log.address, event: decoded.eventName, blockNumber: Number(BigInt(log.blockNumber)), blockHash: log.blockHash, transactionHash: log.transactionHash, logIndex: Number(BigInt(log.logIndex)), args, transactionFrom: sender })
  }
  return output
}
export async function events(url: URL, block: Block, upstreamFetch: typeof fetch, store: CursorStore): Promise<object> {
  const owner = url.searchParams.get('owner')
  if (owner !== null && !/^0x[0-9a-fA-F]{40}$/.test(owner)) throw new BadRequest('Invalid owner')
  const saved = await loadCursor<EventCursor>(url, 'events', store, integer(url.searchParams.get('fromBlock'), FIRST_BLOCK))
  if (saved) await verifyAnchor(saved, upstreamFetch)
  const state = saved ?? await initial(url, block, coverage(url, block), upstreamFetch)
  await discoverPools(state, upstreamFetch)
  if (state.discoveryNextBlock > state.range.toBlock) await scanLogs(state, upstreamFetch)
  const preparing = state.discoveryNextBlock <= state.range.toBlock || state.addressOffset < state.addresses.length
  let output: DexEvent[] = []
  if (!preparing) {
    state.logs = ordered(state.logs)
    const slice = state.logs.slice(state.offset, state.offset + MAX_EVENTS)
    output = await pageEvents(slice, owner, state, upstreamFetch)
    state.offset += slice.length
  }
  const more = preparing || state.offset < state.logs.length
  await verifyAnchor(state, upstreamFetch)
  return { schemaVersion: 1, chainId: 196, asOf: state.asOf, coverage: { ...state.range, complete: state.range.complete && !more }, events: output, phase: preparing ? 'discovery' : 'events', nextCursor: more ? await store.put(state) : null, discovery: { fromBlock: FIRST_BLOCK, throughBlock: state.discoveryNextBlock - 1, targetBlock: state.range.toBlock, poolCount: state.v3Pools.length, scannedAddresses: state.addressOffset, totalAddresses: state.addresses.length } }
}
