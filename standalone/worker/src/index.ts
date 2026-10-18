import { proxyRpc } from './rpc'
import { dexApi } from './dex-api'
import { referenceApi } from './reference-api'
import { ordersApi } from './orders-api'
import preferencesScript from '../../web/dist/preferences-script.json'
import { networkProfile, publicNetworkProfile, type NetworkProfile } from '../../network-profile'
import { miningApi, miningCatalog, type MiningApiBinding } from './mining-api'

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  ORDERS_API?: { fetch: typeof fetch }
  MINING_API?: MiningApiBinding
  SODADEX_NETWORK_PROFILE?: string
  SODADEX_MINING_MOUNT?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    let path = url.pathname
    let profile: NetworkProfile
    try { profile = networkProfile(env.SODADEX_NETWORK_PROFILE) }
    catch { return Response.json({ error: 'Network profile unavailable' }, { status: 503 }) }
    // Fixed mount, enabled only by deployment config; headers never select a chain.
    if (path === '/mining' || path.startsWith('/mining/')) {
      if (env.SODADEX_MINING_MOUNT !== 'enabled' || profile.id !== '196-test')
        return Response.json({ error: 'Mining mount unavailable' }, { status: 404 })
      if (path === '/mining') { url.pathname = '/mining/'; return Response.redirect(url.toString(), 308) }
      profile = networkProfile('1952-mining-test')
      if (path.startsWith('/mining/api/')) {
        url.pathname = path.slice('/mining'.length)
        request = new Request(url, request)
        path = url.pathname
      } else if (path !== '/mining/' && path !== '/mining/index.html' &&
        !path.startsWith('/mining/assets/') && !['/mining/network-build.json', '/mining/preferences-script.json', '/mining/favicon.svg', '/mining/brand.svg'].includes(path)) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
    }
    if (path === '/api/network') return request.method === 'GET'
      ? Response.json(publicNetworkProfile(profile), { headers: { 'Cache-Control': 'no-store' } })
      : Response.json({ error: 'GET required' }, { status: 405 })
    if (path === '/api/mining' || path.startsWith('/api/mining/')) return miningApi(request, env.MINING_API, profile)
    if (path === '/api/rpc') return proxyRpc(request, fetch, profile,
      profile.chainId === 1952 ? await miningCatalog(env.MINING_API, new URL(request.url).origin) : undefined)
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
