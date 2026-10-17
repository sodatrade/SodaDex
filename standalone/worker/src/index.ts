import { proxyRpc } from './rpc'
import { dexApi } from './dex-api'
import { referenceApi } from './reference-api'
import { ordersApi } from './orders-api'
import preferencesScript from '../../web/dist/preferences-script.json'
import { networkProfile, publicNetworkProfile, type NetworkProfile } from '../../network-profile'

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  ORDERS_API?: { fetch: typeof fetch }
  SODADEX_NETWORK_PROFILE?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname
    let profile: NetworkProfile
    try { profile = networkProfile(env.SODADEX_NETWORK_PROFILE) }
    catch { return Response.json({ error: 'Network profile unavailable' }, { status: 503 }) }
    if (path === '/api/network') return request.method === 'GET'
      ? Response.json(publicNetworkProfile(profile), { headers: { 'Cache-Control': 'no-store' } })
      : Response.json({ error: 'GET required' }, { status: 405 })
    if (path === '/api/rpc') return proxyRpc(request, fetch, profile)
    if (!profile.dexEnabled && (path === '/api/dex' || path.startsWith('/api/dex/') ||
      path === '/api/reference' || path.startsWith('/api/reference/') ||
      path === '/api/orders' || path.startsWith('/api/orders/')))
      return Response.json({ error: 'Contracts are not deployed for this network profile', chainId: profile.chainId }, { status: 503 })
    if (path === '/api/orders' || path.startsWith('/api/orders/')) return ordersApi(request, env.ORDERS_API?.fetch.bind(env.ORDERS_API))
    if (path.startsWith('/api/reference/')) return referenceApi(request)
    if (path.startsWith('/api/dex/')) return dexApi(request)
    if (path.startsWith('/api/')) return Response.json({ error: 'Not found' }, { status: 404 })
    const response = await env.ASSETS.fetch(request)
    const headers = new Headers(response.headers)
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self' '${preferencesScript.hash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  },
}
