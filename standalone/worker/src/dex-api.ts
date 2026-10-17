import { coverage, head, BadRequest } from './dex-data'
import { events } from './dex-events'
import { market } from './dex-market'
import { poolPage } from './dex-pools'
import { chart, ChartRangeTooLarge } from './dex-chart'
import { cacheCursorStore, RestartScan, type CursorStore } from './cursors'
export async function dexApi(request: Request, upstreamFetch: typeof fetch = fetch, cursorStore?: CursorStore): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  if (request.method !== 'GET') return Response.json({ error: 'GET required' }, { status: 405, headers })
  const url = new URL(request.url)
  const origin = request.headers.get('Origin')
  if (origin && origin !== url.origin) return Response.json({ error: 'Origin not allowed' }, { status: 403, headers })
  if (!['/api/dex/pools', '/api/dex/events', '/api/dex/market', '/api/dex/chart'].includes(url.pathname)) return Response.json({ error: 'Not found' }, { status: 404, headers })
  try {
    const block = await head(upstreamFetch)
    const store = cursorStore ?? cacheCursorStore(url.origin)
    if (url.pathname === '/api/dex/chart') return Response.json(await chart(url, block, upstreamFetch, store), { headers })
    if (url.pathname === '/api/dex/pools') return Response.json(await poolPage(url, block, upstreamFetch, store), { headers })
    if (url.pathname === '/api/dex/events') return Response.json(await events(url, block, upstreamFetch, store), { headers })
    return Response.json(await market(url, block, coverage(url, block, true), upstreamFetch), { headers })
  } catch (error) {
    if (error instanceof RestartScan) return Response.json({ error: error.message, code: error.code, restartFromBlock: error.restartFromBlock }, { status: 409, headers })
    if (error instanceof ChartRangeTooLarge) return Response.json({ error: error.message, code: 'CHART_RANGE_TOO_LARGE' }, { status: 400, headers })
    return Response.json({ error: error instanceof BadRequest ? error.message : 'Chain data temporarily unavailable' }, { status: error instanceof BadRequest ? 400 : 502, headers })
  }
}
