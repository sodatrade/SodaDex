import { fragmentsIndexApi } from './chain-index/fragments'
import { fragmentsRpc } from './fragments-rpc'
import { indexedChartSource } from './chain-index/chart-source'
import { indexedDexFetch } from './chain-index/log-cache'
import { chainIndexApi } from './chain-index/durable'
import type { IndexEnv } from './chain-index/types'
export { SodaChainIndex } from './chain-index/durable'
import { proxyRpc } from './rpc'
import { dexApi } from './dex-api'
import { referenceApi } from './reference-api'
import { ordersApi } from './orders-api'
import preferencesScript from '../../web/dist/preferences-script.json'
import { networkProfile, publicNetworkProfile, type NetworkProfile } from '../../network-profile'

interface Env extends IndexEnv {
  SODADEX_FRAGMENTS_DEPLOYMENT?: string
  ASSETS: { fetch(request: Request): Promise<Response> }
  ORDERS_API?: { fetch: typeof fetch }
  SODADEX_NETWORK_PROFILE?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    let profile: NetworkProfile
    try { profile = networkProfile(env.SODADEX_NETWORK_PROFILE) }
    catch { return Response.json({ error: 'Network profile unavailable' }, { status: 503 }) }
    // Mining execution belongs to IGNIX; legacy profiles and mounted APIs stay retired.
    if (!profile.dexEnabled || path === '/mining' || path.startsWith('/mining/') ||
        path === '/api/mining' || path.startsWith('/api/mining/'))
      return Response.json({ error: 'Mining features have moved to IGNIX', code: 'MINING_RETIRED', chainId: profile.chainId },
        { status: 410, headers: { 'Cache-Control': 'no-store' } })
    if (path === '/api/fragments/market') return fragmentsIndexApi(request, env)
    if (path === '/api/fragments/rpc') return fragmentsRpc(request, env.SODADEX_FRAGMENTS_DEPLOYMENT)
    if (path === '/api/network') return request.method === 'GET'
      ? Response.json(publicNetworkProfile(profile), { headers: { 'Cache-Control': 'no-store' } })
      : Response.json({ error: 'GET required' }, { status: 405 })
    if (path.startsWith('/api/index/')) return chainIndexApi(request, env, profile.id)
    if (env.CHAIN_INDEX && profile.dexEnabled && ['/api/dex/pools', '/api/dex/events'].includes(path)) return chainIndexApi(request, env, profile.id, true)
    if (path === '/api/rpc') return proxyRpc(request, fetch, profile)
    if (path === '/api/orders' || path.startsWith('/api/orders/')) return ordersApi(request, env.ORDERS_API?.fetch.bind(env.ORDERS_API))
    if (path.startsWith('/api/reference/')) return referenceApi(request)
    if (path.startsWith('/api/dex/')) return dexApi(request, indexedDexFetch(env), undefined, indexedChartSource(env))
    if (path.startsWith('/api/')) return Response.json({ error: 'Not found' }, { status: 404 })
    const response = await env.ASSETS.fetch(request)
    const headers = new Headers(response.headers)
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self' '${preferencesScript.hash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  },
}
