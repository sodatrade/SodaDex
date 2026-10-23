import { BadRequest, head, integer, knownPools, type Block } from '../dex-data'
import { same } from '../contracts'
import { blockAt } from '../cursors'
import type { IndexStore } from './store'
import type { IndexConfig, SavedCursor, SqlValue } from './types'
export class IndexRestart extends Error {}
const validAddress = (value: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(value)
export function indexQuery(url: URL): string {
  if (url.searchParams.getAll('cursor').length > 1) throw new BadRequest('Invalid cursor')
  const params = [...url.searchParams.entries()].filter(([key]) => key !== 'cursor')
  if (params.some(([key]) => !['owner', 'pool', 'event', 'fromBlock', 'toBlock', 'limit'].includes(key)) || new Set(params.map(([key]) => key)).size !== params.length) throw new BadRequest('Invalid index query')
  // oxlint-disable-next-line unicorn/no-array-sort -- Sort a new parameter array to bind cursors independently of query ordering.
  return JSON.stringify([url.pathname, params.sort(([a], [b]) => a.localeCompare(b))])
}
export async function indexPage(url: URL, store: IndexStore, config: IndexConfig, read: typeof fetch, legacy = false): Promise<object> {
  const state = store.status(), kind = url.pathname.split('/').at(-1), query = indexQuery(url)
  if (kind === 'status') return state
  if (kind !== 'events' && kind !== 'pools') throw new BadRequest('Unknown index endpoint')
  const limit = integer(url.searchParams.get('limit'), 10)
  if (limit < 1 || limit > 10) throw new BadRequest('Page size must be between 1 and 10')
  const cursor = url.searchParams.get('cursor')
  if (cursor && !/^[0-9a-f-]{36}$/.test(cursor)) throw new BadRequest('Invalid cursor')
  const saved = cursor ? store.cursor(cursor) : null
  if (cursor && (!saved || saved.query !== query || saved.generation !== state.generation)) throw new IndexRestart('Index changed or cursor expired; restart from the first page')
  const asOf: Block | null = saved?.asOf ?? store.anchor() ?? (legacy ? await head(read) : null)
  if (saved?.asOf && !same((await blockAt(saved.asOf.number, read)).hash, saved.asOf.hash)) throw new IndexRestart('Chain changed; restart from the first page')
  const through = saved?.through ?? state.indexedThrough, offset = saved?.offset ?? 0
  const from = integer(url.searchParams.get('fromBlock'), config.fromBlock), to = integer(url.searchParams.get('toBlock'), Math.max(config.fromBlock, through))
  if (from < config.fromBlock || to < from) throw new BadRequest('Invalid index block range')
  const coverage = { fromBlock: from, toBlock: Math.max(from - 1, Math.min(to, through)), complete: through >= to && !state.syncing && !state.lastError, nextFromBlock: null }
  let rows: object[]
  if (kind === 'pools') {
    if (['owner', 'pool', 'event'].some(key => url.searchParams.has(key))) throw new BadRequest('Unsupported pool filter')
    const pools = [...new Map([...(config.profile.chainId === 196 ? knownPools() : []), ...store.pools(through)].map(p => [p.id.toLowerCase(), p])).values()]
    rows = pools.slice(offset, offset + limit + 1)
  } else {
    const owner = url.searchParams.get('owner'), pool = url.searchParams.get('pool'), event = url.searchParams.get('event')
    if (owner && !validAddress(owner) || pool && !/^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(pool) || event && !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(event)) throw new BadRequest('Invalid event filter')
    const clauses = ['block_number BETWEEN ? AND ?'], values: SqlValue[] = [from, Math.min(to, through)]
    if (owner) { clauses.push('(sender=? OR EXISTS(SELECT 1 FROM json_each(index_events.args) WHERE lower(value)=?))'); values.push(owner.toLowerCase(), owner.toLowerCase()) }
    if (pool) { clauses.push('(address=? OR lower(json_extract(args,\'$.id\'))=?)'); values.push(pool.toLowerCase(), pool.toLowerCase()) }
    if (event) { clauses.push('event=?'); values.push(event) }
    rows = store.events(clauses.join(' AND '), values, offset).slice(0, limit + 1)
  }
  const more = rows.length > limit
  const context: SavedCursor = { query, generation: state.generation, through, asOf, offset: offset + limit, expires: Date.now() + 3_600_000 }
  return { schemaVersion: 1, chainId: config.profile.chainId, deploymentVersion: config.version, asOf, coverage,
    [kind]: rows.slice(0, limit), nextCursor: more ? store.saveCursor(context) : null, index: state,
    ...(kind === 'pools' ? { discoveryComplete: !state.syncing && !state.lastError, discoveryStartBlock: config.fromBlock, discoveryTargetBlock: state.head?.number ?? null } : { phase: 'events' }) }
}
