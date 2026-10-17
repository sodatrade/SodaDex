import { proxyRpc } from './rpc'
import { dexApi } from './dex-api'
import { referenceApi } from './reference-api'
import { ordersApi } from './orders-api'
import preferencesScript from '../../web/dist/preferences-script.json'

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  ORDERS_API?: { fetch: typeof fetch }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/api/orders' || path.startsWith('/api/orders/')) return ordersApi(request, env.ORDERS_API?.fetch.bind(env.ORDERS_API))
    if (path.startsWith('/api/reference/')) return referenceApi(request)
    if (path.startsWith('/api/dex/')) return dexApi(request)
    if (path === '/api/rpc') return proxyRpc(request)
    if (path.startsWith('/api/')) return Response.json({ error: 'Not found' }, { status: 404 })
    const response = await env.ASSETS.fetch(request)
    const headers = new Headers(response.headers)
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self' '${preferencesScript.hash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'`)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  },
}
