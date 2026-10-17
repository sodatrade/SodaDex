import { same } from './contracts'
import { BadRequest, head } from './dex-data'
import { referencePools } from './reference-pools'
import { referenceQuote } from './reference-quotes'
import { referenceAddress, referenceTokenList } from './reference-tokens'
import { rpc } from './upstream'
export async function referenceApi(request: Request, upstreamFetch: typeof fetch = fetch): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  if (request.method !== 'GET') return Response.json({ error: 'GET required' }, { status: 405, headers })
  const url = new URL(request.url), origin = request.headers.get('Origin')
  if (origin && origin !== url.origin) return Response.json({ error: 'Origin not allowed' }, { status: 403, headers })
  const allowed = url.pathname === '/api/reference/tokens' ? [] : url.pathname === '/api/reference/pools' ? ['token0', 'token1'] : url.pathname === '/api/reference/quote' ? ['protocol', 'tokenIn', 'tokenOut', 'amountInRaw', 'fee', 'tickSpacing'] : null
  if (allowed === null) return Response.json({ error: 'Not found' }, { status: 404, headers })
  if ([...url.searchParams.keys()].some((key) => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1)) return Response.json({ error: 'Unsupported query parameter' }, { status: 400, headers })
  try {
    if (url.pathname === '/api/reference/tokens') return Response.json(referenceTokenList(), { headers })
    // Reject invalid addresses before touching the fixed upstream.
    const pair = url.pathname === '/api/reference/pools' ? [referenceAddress(url.searchParams.get('token0')), referenceAddress(url.searchParams.get('token1'))] : [referenceAddress(url.searchParams.get('tokenIn')), referenceAddress(url.searchParams.get('tokenOut'))]
    if (same(pair[0], pair[1])) throw new BadRequest('Distinct tokens required')
    if (await rpc('eth_chainId', [], upstreamFetch) !== '0xc4') throw new Error('Wrong reference chain')
    const block = await head(upstreamFetch)
    return Response.json(url.pathname === '/api/reference/pools' ? await referencePools(pair[0], pair[1], block, upstreamFetch) : await referenceQuote(url, block, upstreamFetch), { headers })
  } catch (error) {
    return Response.json({ error: error instanceof BadRequest ? error.message : 'Reference chain data temporarily unavailable' }, { status: error instanceof BadRequest ? 400 : 502, headers })
  }
}
