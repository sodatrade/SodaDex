import { V2_FACTORY, V2_PAIR_EVENTS } from '../../../v2-protocol'
import { fragmentIndexConfig, fragmentMarket } from './fragments'
import { miningMarket } from './mining-market'
import { EVENTS, record, same } from '../contracts'
import { toEventSelector } from 'viem'
import { matchesTopics } from './log-cache'
import { networkProfile, type NetworkProfileId } from '../../../network-profile'
import { BadRequest, integer } from '../dex-data'
import { actorName, baseConfig, currentConfig } from './config'
import { indexPage, IndexRestart } from './api'
import { IndexStore } from './store'
import { indexFetch, scanOnce, verifyIndex } from './scan'
import type { IndexEnv, IndexSource, Storage } from './types'
/** A separate read-only actor: it has no access to keeper state, budgets or signing keys. */
export class SodaChainIndex {
  #tail: Promise<void> = Promise.resolve()
  #alarmRunning = false
  constructor(readonly state: { storage: Storage }, readonly env: IndexEnv) {}
  #serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(action); this.#tail = result.then(() => {}, () => {}); return result
  }
  fetch(request: Request): Promise<Response> {
    const action = async (): Promise<Response> => {
      const url = new URL(request.url), id = url.pathname.split('/')[1] as NetworkProfileId
      try {
        const fragments = url.pathname.startsWith('/fragments/')
        const config = fragments ? fragmentIndexConfig(this.env) : baseConfig(id, this.env), store = new IndexStore(this.state.storage, config)
        if (fragments) {
          if (request.method !== 'GET' || url.pathname !== '/fragments/market') throw new BadRequest('Unknown fragment endpoint')
          const response = fragmentMarket(url, store, config)
          if (await this.state.storage.getAlarm() === null && !this.#alarmRunning) await this.state.storage.setAlarm(Date.now() + 1000)
          return Response.json(response)
        }
        const read = indexFetch(config)
        if (!await verifyIndex(store, read)) throw new IndexRestart('Chain changed; index rebuilding')
        url.pathname = url.pathname.slice(id.length + 1)
        if (url.pathname === '/chart-source' && request.method === 'GET' && id === '196-test') {
          const pool = url.searchParams.get('pool'), anchor = store.anchor()
          if (!pool || !/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(pool)) throw new BadRequest('Invalid pool')
          if (!anchor) { await this.state.storage.setAlarm(Date.now() + 1000); return Response.json({ error: 'Index warming up' }, { status: 503 }) }
          const from = integer(url.searchParams.get('fromBlock'), config.fromBlock)
          const to = Math.min(integer(url.searchParams.get('toBlock'), anchor.number), anchor.number)
          if (from < config.fromBlock || from > to) throw new BadRequest('Invalid block range')
          if (await this.state.storage.getAlarm() === null && !this.#alarmRunning) await this.state.storage.setAlarm(Date.now() + 1000)
          return Response.json({ asOf: anchor, rows: store.chartRows(pool, from, to) })
        }
        if (url.pathname === '/logs' && request.method === 'POST' && id === '196-test') {
          const filter: unknown = await request.json()
          if (!record(filter) || typeof filter.fromBlock !== 'string' || typeof filter.toBlock !== 'string' || !/^0x[0-9a-f]+$/i.test(filter.fromBlock) || !/^0x[0-9a-f]+$/i.test(filter.toBlock) || !Array.isArray(filter.topics)) return Response.json({ logs: null })
          const from = Number(BigInt(filter.fromBlock)), to = Number(BigInt(filter.toBlock)), addresses = (Array.isArray(filter.address) ? filter.address : [filter.address]) as unknown[]
          const known = [...config.sources.map(s => s.address), ...store.pools(store.status().indexedThrough).flatMap(p => p.address ? [p.address] : [])]
          const selectors = [...EVENTS, ...V2_PAIR_EVENTS, ...V2_FACTORY.filter(e => e.type === 'event')].map(e => toEventSelector(e)), first = Array.isArray(filter.topics[0]) ? filter.topics[0] : [filter.topics[0]]
          if (!addresses.length || addresses.some(a => typeof a !== 'string' || !known.some(k => same(k, a))) || !first.length || first.some(t => typeof t !== 'string' || !selectors.some(k => same(k, t))) || from < config.fromBlock || to < from || to - from >= 2000 || to > store.status().indexedThrough) return Response.json({ logs: null })
          return Response.json({ logs: store.logs(addresses as string[], from, to).filter(log => matchesTopics(log.topics, filter.topics as unknown[])) })
        }
        const response = url.pathname === '/market' ? miningMarket(url, store, config) : await indexPage(url, store, config, read, request.headers.get('X-Index-Legacy') === 'true')
        if (await this.state.storage.getAlarm() === null && !this.#alarmRunning) await this.state.storage.setAlarm(Date.now() + 1000)
        return Response.json(response)
      } catch (error) {
        if (error instanceof IndexRestart) { if (!this.#alarmRunning) await this.state.storage.setAlarm(Date.now() + 1000); return Response.json({ error: error.message, code: 'CHAIN_REORGANIZED' }, { status: 409 }) }
        return Response.json({ error: error instanceof BadRequest ? error.message : 'Chain index temporarily unavailable' }, { status: error instanceof BadRequest ? 400 : 502 })
      }
    }
    // Fragment pages only read atomically committed SQLite rows; do not queue them behind a network scan.
    return new URL(request.url).pathname.startsWith('/fragments/') ? action() : this.#serial(action)
  }
  alarm(): Promise<void> {
    return this.#serial(async () => {
      this.#alarmRunning = true
      const row = this.state.storage.sql.exec('SELECT value FROM index_meta WHERE id=1').toArray()[0]
      if (!row) return
      const saved = JSON.parse(String(row.value))
      const id = networkProfile(saved.profileId ?? (saved.chainId === 196 ? '196-test' : '1952-mining-test')).id
      const config = String(saved.deploymentVersion).startsWith('fragments-') ? fragmentIndexConfig(this.env) : await currentConfig(id, this.env), store = new IndexStore(this.state.storage, config)
      try {
        store.query('CREATE TABLE IF NOT EXISTS index_sources(id INTEGER PRIMARY KEY,value TEXT NOT NULL)')
        const old = store.query('SELECT value FROM index_sources WHERE id=1')[0]?.value
        const retained: IndexSource[] = old ? JSON.parse(String(old)) as IndexSource[] : []
        // A temporary catalog outage must not erase already service-proven sources.
        const merged = new Map(retained.map(source => [source.address, source]))
        const added = config.sources.some(source => !merged.has(source.address))
        for (const source of config.sources) merged.set(source.address, source)
        config.sources = [...merged.values()]
        if (old && added) store.restartSources()
        store.query('INSERT OR REPLACE INTO index_sources VALUES(1,?)', JSON.stringify(config.sources))
        await scanOnce(store, config)
      } catch (error) { console.warn('Chain index scan failed', error instanceof Error ? error.message : 'Unknown scan error'); store.fail() }
      finally { await this.state.storage.setAlarm(Date.now() + (store.status().lastError ? 30_000 : store.status().syncing ? 1000 : 30_000)) }
    }).finally(() => { this.#alarmRunning = false })
  }
}
export async function chainIndexApi(request: Request, env: IndexEnv, profileId: NetworkProfileId, legacy = false): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  if (request.method !== 'GET') return Response.json({ error: 'GET required' }, { status: 405, headers })
  const url = new URL(request.url), origin = request.headers.get('Origin')
  if (origin && origin !== url.origin) return Response.json({ error: 'Origin not allowed' }, { status: 403, headers })
  if (!env.CHAIN_INDEX) return Response.json({ error: 'Chain index unavailable' }, { status: 503, headers })
  try {
    networkProfile(profileId)
    const config = baseConfig(profileId, env), path = url.pathname.split('/').at(-1)
    if (!['status', 'events', 'pools', 'market'].includes(path!)) return Response.json({ error: 'Not found' }, { status: 404, headers })
    const internal = new URL(`https://index.internal/${profileId}/${path}${url.search}`)
    const response = await env.CHAIN_INDEX.get(env.CHAIN_INDEX.idFromName(actorName(config))).fetch(new Request(internal, { headers: { 'X-Index-Legacy': String(legacy) } }))
    return new Response(response.body, { status: response.status, headers: { ...headers, 'Content-Type': 'application/json' } })
  } catch { return Response.json({ error: 'Chain index temporarily unavailable' }, { status: 502, headers }) }
}
