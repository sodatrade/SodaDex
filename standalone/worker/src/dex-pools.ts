import { FIRST_BLOCK } from './contracts'
import { coverage, discover, integer, knownPools, snapshot, type Block } from './dex-data'
import { blockAt, loadCursor, queryKey, verifyAnchor, type CursorStore, type ScanCursor } from './cursors'
interface PoolCursor extends ScanCursor { kind: 'pools'; nextFromBlock: number; targetBlock: number }
export async function poolPage(url: URL, current: Block, upstreamFetch: typeof fetch, store: CursorStore): Promise<object> {
  const saved = await loadCursor<PoolCursor>(url, 'pools', store, integer(url.searchParams.get('fromBlock'), FIRST_BLOCK))
  if (saved) await verifyAnchor(saved, upstreamFetch)
  const asOf = saved?.asOf ?? current
  const rangeUrl = new URL(url)
  if (saved) {
    rangeUrl.searchParams.set('fromBlock', String(saved.nextFromBlock))
    rangeUrl.searchParams.set('toBlock', String(saved.targetBlock))
  }
  const range = coverage(rangeUrl, asOf)
  const targetBlock = saved?.targetBlock ?? Math.min(integer(url.searchParams.get('toBlock'), asOf.number), asOf.number)
  const anchor = saved?.anchor ?? (targetBlock === asOf.number ? asOf : await blockAt(targetBlock, upstreamFetch))
  const discovered = await discover(range, upstreamFetch)
  const merged = [...new Map([...knownPools(), ...discovered].map((pool) => [pool.id.toLowerCase(), pool])).values()]
  const pools = await Promise.all(merged.map((pool, index) => index < 8 ? snapshot(pool, asOf, upstreamFetch) : { ...pool, stateError: 'Snapshot request limit; open market detail' }))
  const context: PoolCursor = { kind: 'pools', query: queryKey(url), asOf, anchor, range: saved?.range ?? range, targetBlock, nextFromBlock: range.nextFromBlock ?? targetBlock + 1 }
  await verifyAnchor(context, upstreamFetch)
  const nextCursor = range.nextFromBlock === null ? null : await store.put(context)
  return { schemaVersion: 1, chainId: 196, asOf, coverage: range, pools, nextCursor, discoveryComplete: nextCursor === null, discoveryStartBlock: saved?.range.fromBlock ?? range.fromBlock, discoveryTargetBlock: targetBlock }
}
