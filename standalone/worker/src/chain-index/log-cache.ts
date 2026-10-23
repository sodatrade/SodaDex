import { record, same } from '../contracts'
import { RPC_URL } from '../upstream'
import { actorName, baseConfig } from './config'
import type { IndexEnv } from './types'
/** Historical chart/market reads reuse canonical indexed logs; all other RPCs stay live. */
export function indexedDexFetch(env: IndexEnv, upstream: typeof fetch = fetch): typeof fetch {
  return async (input, options) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!env.CHAIN_INDEX || url !== RPC_URL || typeof options?.body !== 'string') return upstream(input, options)
    const payload: unknown = JSON.parse(options.body)
    if (!record(payload) || payload.method !== 'eth_getLogs' || !Array.isArray(payload.params)) return upstream(input, options)
    try {
      const config = baseConfig('196-test'), response = await env.CHAIN_INDEX.get(env.CHAIN_INDEX.idFromName(actorName(config))).fetch(new Request('https://index.internal/196-test/logs', { method: 'POST', body: JSON.stringify(payload.params[0]) }))
      const value: unknown = await response.json()
      if (response.ok && record(value) && Array.isArray(value.logs)) return Response.json({ jsonrpc: '2.0', id: payload.id, result: value.logs })
    } catch { /* A cache miss or unavailable index falls back to the existing validated chain reader. */ }
    return upstream(input, options)
  }
}
export function matchesTopics(topics: string[], filter: unknown[]): boolean {
  return filter.every((topic, i) => topic === null || (Array.isArray(topic) ? topic.some(t => typeof t === 'string' && same(t, topics[i] ?? '')) : typeof topic === 'string' && same(topic, topics[i] ?? '')))
}
