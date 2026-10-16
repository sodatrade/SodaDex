import { record } from './contracts'
import { type Block, type Coverage, hex } from './dex-data'
import { rpc, RpcUnavailable } from './upstream'

export interface CursorStore {
  get(id: string): Promise<unknown | null>
  put(value: object): Promise<string>
}
export interface ScanCursor {
  kind: 'pools' | 'events'
  query: string
  asOf: Block
  anchor: Block
  range: Coverage
}
export class RestartScan extends Error {
  constructor(readonly code: 'CHAIN_REORGANIZED' | 'CURSOR_EXPIRED', readonly restartFromBlock: number) { super(code === 'CHAIN_REORGANIZED' ? 'Chain reorganized; restart range' : 'Cursor expired; restart range') }
}
export function queryKey(url: URL): string {
  const query = new URLSearchParams(url.search)
  query.delete('cursor')
  query.sort()
  return url.pathname + '?' + query.toString()
}
export function cacheCursorStore(origin: string): CursorStore {
  const storage = typeof caches === 'undefined' ? undefined : (caches as CacheStorage & { default?: Cache }).default
  const key = (id: string): Request => new Request(`${origin}/__dex_cursor/${id}`)
  return {
    async get(id) {
      if (!storage || !/^[0-9a-f-]{36}$/.test(id)) return null
      const value = await storage.match(key(id))
      return value ? value.json() : null
    },
    async put(value) {
      if (!storage) throw new RpcUnavailable('Cursor cache unavailable')
      const id = crypto.randomUUID()
      await storage.put(key(id), Response.json(value, { headers: { 'Cache-Control': 'public, max-age=3600' } }))
      return id
    },
  }
}
export async function loadCursor<T extends ScanCursor>(url: URL, kind: T['kind'], store: CursorStore, restartFromBlock: number): Promise<T | null> {
  const id = url.searchParams.get('cursor')
  if (id === null) return null
  const value = await store.get(id)
  if (!record(value) || value.kind !== kind || value.query !== queryKey(url) || !record(value.anchor) || !record(value.asOf) || !record(value.range)) throw new RestartScan('CURSOR_EXPIRED', restartFromBlock)
  return value as unknown as T
}
class MissingAnchorBlock extends Error {}
export async function blockAt(number: number, upstreamFetch: typeof fetch): Promise<Block> {
  const value = await rpc('eth_getBlockByNumber', [hex(number), false], upstreamFetch)
  if (value === null) throw new MissingAnchorBlock('Anchor no longer exists')
  if (!record(value) || typeof value.number !== 'string' || Number(BigInt(value.number)) !== number || typeof value.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value.hash) || typeof value.timestamp !== 'string') throw new RpcUnavailable('Invalid block response')
  return { number, hash: value.hash, timestamp: Number(BigInt(value.timestamp)) }
}
export async function verifyAnchor(cursor: ScanCursor, upstreamFetch: typeof fetch): Promise<void> {
  try {
    const current = await blockAt(cursor.anchor.number, upstreamFetch)
    if (current.hash.toLowerCase() !== cursor.anchor.hash.toLowerCase()) throw new RestartScan('CHAIN_REORGANIZED', cursor.range.fromBlock)
  } catch (error) {
    if (error instanceof MissingAnchorBlock) throw new RestartScan('CHAIN_REORGANIZED', cursor.range.fromBlock)
    throw error
  }
}
