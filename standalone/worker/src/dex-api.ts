import { coverage, discover, head, knownPools, snapshot, BadRequest } from './dex-data'
import { events } from './dex-events'
import { market } from './dex-market'
export async function dexApi(request: Request, upstreamFetch: typeof fetch = fetch): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  if (request.method !== 'GET') return Response.json({ error: 'GET required' }, { status: 405, headers })
  const url = new URL(request.url)
  const origin = request.headers.get('Origin')
  if (origin && origin !== url.origin) return Response.json({ error: 'Origin not allowed' }, { status: 403, headers })
  if (!['/api/dex/pools', '/api/dex/events', '/api/dex/market'].includes(url.pathname)) return Response.json({ error: 'Not found' }, { status: 404, headers })
  try {
    const block = await head(upstreamFetch)
    const range = coverage(url, block, url.pathname !== '/api/dex/events')
    if (url.pathname === '/api/dex/events') return Response.json(await events(url, block, range, upstreamFetch), { headers })
    if (url.pathname === '/api/dex/market') return Response.json(await market(url, block, range, upstreamFetch), { headers })
    const discovered = await discover(range, upstreamFetch)
    const merged = [...new Map([...knownPools(), ...discovered].map((pool) => [pool.id.toLowerCase(), pool])).values()]
    const pools = await Promise.all(merged.map((pool, index) => index < 8 ? snapshot(pool, block, upstreamFetch) : { ...pool, stateError: 'Snapshot request limit; open market detail' }))
    return Response.json({ schemaVersion: 1, chainId: 196, asOf: block, coverage: range, pools }, { headers })
  } catch (error) {
    return Response.json({ error: error instanceof BadRequest ? error.message : 'Chain data temporarily unavailable' }, { status: error instanceof BadRequest ? 400 : 502, headers })
  }
}
