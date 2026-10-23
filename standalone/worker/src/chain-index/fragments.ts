import { keccak256, parseAbi, stringToHex } from 'viem'
import { networkProfile } from '../../../network-profile'
import { BadRequest } from '../dex-data'
import { IndexRestart } from './api'
import type { IndexConfig, IndexEnv, IndexedEvent, SavedCursor } from './types'
import type { IndexStore } from './store'

export const fragmentEvents = parseAbi(['event Swapped(address indexed account,bool shareIn,uint256 input,uint256 output,uint256 platformFee,uint256 lpFee)'])
/** A distinct actor per deployed pool; it never shares historical rows with the old FAB pool. */
export function fragmentIndexConfig(env: IndexEnv): IndexConfig {
  const value = JSON.parse(env.SODADEX_FRAGMENTS_DEPLOYMENT ?? 'null')
  if (!value || value.chainId !== 196 || !/^0x[0-9a-f]{40}$/i.test(value.pool) || BigInt(value.pool) === 0n || !/^\d+$/.test(value.fromBlock) || !Number.isSafeInteger(Number(value.fromBlock))) throw new Error('Fragment deployment unavailable')
  const address = value.pool.toLowerCase(), fromBlock = Number(value.fromBlock)
  return { profile: networkProfile('196-test'), fromBlock,
    version: `fragments-${keccak256(stringToHex(`${address}:${fromBlock}:v1`)).slice(2, 26)}`,
    sources: [{ address, abi: fragmentEvents, protocol: 'mining', role: 'okbFragmentPool' }] }
}
function trade(event: IndexedEvent) {
  const a = event.args
  if (typeof a.shareIn !== 'boolean' || !['input', 'output', 'platformFee', 'lpFee'].every(k => typeof a[k] === 'string' && /^\d+$/.test(a[k] as string))) throw new Error('Invalid indexed trade')
  return { id: event.id, transactionHash: event.transactionHash, timestamp: event.timestamp, blockNumber: event.blockNumber,
    shareIn: a.shareIn, input: String(a.input), output: String(a.output), platformFee: String(a.platformFee), lpFee: String(a.lpFee) }
}
/** No RPC in the request path. Alarms verify canonical blocks and advance the persistent checkpoint. */
export function fragmentMarket(url: URL, store: IndexStore, config: IndexConfig): object {
  if ([...url.searchParams.keys()].some(k => k !== 'cursor') || url.searchParams.getAll('cursor').length > 1) throw new BadRequest('Unsupported market query')
  const state = store.status(), cursor = url.searchParams.get('cursor'), query = config.version
  if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequest('Invalid cursor')
  const saved = cursor ? store.cursor(cursor) : null
  if (cursor && (!saved || saved.query !== query || saved.generation !== state.generation)) throw new IndexRestart('Index changed or page expired; return to the first page')
  const through = saved?.through ?? state.indexedThrough, offset = saved?.offset ?? 0
  const pool = config.sources[0].address
  const rows = store.events("event='Swapped' AND address=? AND block_number<=?", [pool, through], offset)
  const context: SavedCursor = { query, through, offset: offset + 10, asOf: saved?.asOf ?? store.anchor(), generation: state.generation, expires: Date.now() + 3_600_000 }
  // Bound chart output independently of the ten-row history page. All older trades remain stored and pageable.
  const chart = store.query("SELECT value FROM index_events WHERE event='Swapped' AND address=? AND block_number<=? ORDER BY block_number DESC,log_index DESC LIMIT 500", pool, through)
    .map(r => trade(JSON.parse(String(r.value)) as IndexedEvent))
    // oxlint-disable-next-line unicorn/no-array-reverse -- Reverse the freshly mapped chart array; ES2022 target.
    .reverse()
  return { chainId: 196, pool, asOf: context.asOf, index: state, chart, chartLimit: 500, trades: rows.slice(0, 10).map(trade),
    nextCursor: rows.length > 10 ? store.saveCursor(context) : null }
}
export async function fragmentsIndexApi(request: Request, env: IndexEnv): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'application/json' }
  const url = new URL(request.url), origin = request.headers.get('Origin')
  if (request.method !== 'GET') return Response.json({ error: 'GET required' }, { status: 405, headers })
  if (origin && origin !== url.origin) return Response.json({ error: 'Origin not allowed' }, { status: 403, headers })
  if (!env.CHAIN_INDEX) return Response.json({ error: 'Index unavailable' }, { status: 503, headers })
  try {
    const config = fragmentIndexConfig(env)
    const response = await env.CHAIN_INDEX.get(env.CHAIN_INDEX.idFromName(`sodadex-fragments:196:${config.version}`))
      .fetch(new Request(`https://index.internal/fragments/market${url.search}`))
    return new Response(response.body, { status: response.status, headers })
  } catch { return Response.json({ error: 'Index unavailable' }, { status: 503, headers }) }
}
