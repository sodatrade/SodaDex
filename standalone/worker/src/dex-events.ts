import { toEventSelector, type Hex } from 'viem'
import { deployment, EVENTS, MAX_EVENTS, pools, record, same } from './contracts'
import { BadRequest, type Block, type Coverage, decodeLog, logs } from './dex-data'
import { rpc, RpcUnavailable } from './upstream'
import { resolvePool } from './dex-market'
export interface DexEvent {
  id: string; protocol: 'v3' | 'v4'; address: string; event: string; blockNumber: number; blockHash: string; transactionHash: string; logIndex: number
  args: Record<string, string | number | boolean>; transactionFrom: string | null
}
export async function events(url: URL, block: Block, range: Coverage, upstreamFetch: typeof fetch): Promise<object> {
  const owner = url.searchParams.get('owner')
  if (owner !== null && !/^0x[0-9a-fA-F]{40}$/.test(owner)) throw new BadRequest('Invalid owner')
  let offset = 0
  const cursor = url.searchParams.get('cursor')
  if (cursor !== null) {
    const match = /^(\d+):(\d+):(\d+)$/.exec(cursor)
    if (!match || Number(match[1]) !== range.fromBlock || Number(match[2]) !== range.toBlock || !Number.isSafeInteger(Number(match[3]))) throw new BadRequest('Cursor does not match range')
    offset = Number(match[3])
  }
  const selected = url.searchParams.has('pool') ? await resolvePool(url, block, upstreamFetch) : null
  const addresses = selected ? [selected.address ?? deployment.contracts.v4PoolManager] : [deployment.contracts.v3Factory, deployment.contracts.v3PositionManager, deployment.contracts.v4PoolManager, deployment.contracts.v4PositionManager, pools.v3.address]
  const topics: (Hex | Hex[] | null)[] = selected?.protocol === 'v4' ? [[toEventSelector(EVENTS[1]), toEventSelector(EVENTS[3]), toEventSelector(EVENTS[8])], selected.id as Hex] : [EVENTS.map((event) => toEventSelector(event))]
  const source = await logs(addresses, range.fromBlock, range.toBlock, topics, upstreamFetch)
  if (offset > source.length) throw new BadRequest('Cursor out of range; restart page after chain reorganization')
  const slice = source.slice(offset, offset + MAX_EVENTS)
  const senders = new Map<string, string>()
  if (owner) {
    await Promise.all([...new Set(slice.map((log) => log.transactionHash))].map(async (hash) => {
      const tx = await rpc('eth_getTransactionByHash', [hash], upstreamFetch)
      if (!record(tx) || typeof tx.from !== 'string' || !same(String(tx.hash), hash)) throw new RpcUnavailable('Transaction lookup unavailable')
      senders.set(hash, tx.from)
    }))
  }
  const output: DexEvent[] = []
  for (const log of slice) {
    let decoded: ReturnType<typeof decodeLog>
    try { decoded = decodeLog(log) } catch { throw new RpcUnavailable('Unsupported event result') }
    const sender = senders.get(log.transactionHash) ?? null
    if (owner && !((sender && same(owner, sender)) || (decoded.eventName === 'Transfer' && [decoded.args.from, decoded.args.to].some((address) => typeof address === 'string' && same(owner, address))))) continue
    const args: DexEvent['args'] = {}
    for (const [key, value] of Object.entries(decoded.args)) if (typeof value === 'bigint') args[key] = String(value); else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') args[key] = value
    output.push({ id: `${log.blockHash}:${Number(BigInt(log.logIndex))}`, protocol: [deployment.contracts.v4PoolManager, deployment.contracts.v4PositionManager].some((address) => same(address, log.address)) ? 'v4' : 'v3', address: log.address, event: decoded.eventName, blockNumber: Number(BigInt(log.blockNumber)), blockHash: log.blockHash, transactionHash: log.transactionHash, logIndex: Number(BigInt(log.logIndex)), args, transactionFrom: sender })
  }
  const more = offset + slice.length < source.length
  return { schemaVersion: 1, chainId: 196, asOf: block, coverage: { ...range, complete: range.complete && !more }, events: output, nextCursor: more ? `${range.fromBlock}:${range.toBlock}:${offset + slice.length}` : null }
}
