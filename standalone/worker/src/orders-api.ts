import { ORDER_DEPLOYMENT } from './order-config'
import { deployment } from './contracts'
import type { OrderDeployment } from '../../order-deployment'
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
const error = (status: number, code: string): Response => Response.json({ error: 'Order request unavailable', code }, { status, headers })
const MAX_REQUEST_BYTES = 16384
const MAX_RESPONSE_BYTES = 131072
async function boundedBody(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return ''
  const reader = body.getReader(), chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) { await reader.cancel(); throw Error('Body limit') }
    chunks.push(value)
  }
  const all = new Uint8Array(total); let offset = 0
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(all)
}
function publicData(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true
  return Object.entries(value).every(([key, child]) => !['signature', 'rawTransaction', 'rawTx', 'privateKey'].includes(key) && publicData(child))
}
/** A fixed upstream order service is the only destination; no RPC or signer is exposed. */
export async function ordersApi(request: Request, upstreamFetch: typeof fetch = fetch, configured: OrderDeployment | undefined = ORDER_DEPLOYMENT): Promise<Response> {
  const url = new URL(request.url), origin = request.headers.get('Origin')
  if (origin && origin !== url.origin) return error(403, 'ORIGIN_NOT_ALLOWED')
  const suffix = url.pathname.slice('/api/orders'.length)
  const path = suffix === '/status' ? '/v1/status' : suffix === '' ? '/v1/orders' : /^\/0x[\da-f]{64}$/i.test(suffix) ? `/v1/orders${suffix}` : undefined
  if (!path) return error(404, 'NOT_FOUND')
  const posting = request.method === 'POST' && suffix === ''
  if (request.method !== 'GET' && !posting) return error(405, 'METHOD_NOT_ALLOWED')
  const params = url.searchParams
  if (suffix !== '' || posting) { if (params.size) return error(400, 'VALIDATION_FAILED') }
  else {
    if ([...params.keys()].some(key => !['maker', 'limit', 'cursor'].includes(key) || params.getAll(key).length !== 1) ||
      !/^0x[\da-f]{40}$/i.test(params.get('maker') ?? '') ||
      (params.has('limit') && (!/^\d+$/.test(params.get('limit')!) || Number(params.get('limit')) < 1 || Number(params.get('limit')) > 100)) ||
      (params.has('cursor') && !/^\d{1,20}$/.test(params.get('cursor')!))) return error(400, 'VALIDATION_FAILED')
  }
  if (!configured) return suffix === '/status' ? Response.json({ schemaVersion: 1, service: 'sodadex-orders', chainId: 196,
    settlement: null, permit2: deployment.permit2, wrappedNative: deployment.wrappedNative, testDeployment: true,
    executionEnabled: false, acceptingOrders: false, reason: 'NOT_DEPLOYED' }, { headers }) : error(503, 'NOT_DEPLOYED')
  if (posting && !request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return error(415, 'JSON_REQUIRED')
  let body: string | undefined
  if (posting) {
    try { body = await boundedBody(request.body, MAX_REQUEST_BYTES); JSON.parse(body) } catch { return error(413, 'BODY_LIMIT_OR_INVALID_JSON') }
  }
  try {
    const target = new URL(path, configured.apiOrigin); target.search = url.search
    const response = await upstreamFetch(target, { method: request.method, ...(posting ? { body } : {}),
      headers: { 'Content-Type': 'application/json', Origin: url.origin }, redirect: 'manual', signal: AbortSignal.timeout(12_000) })
    if (response.status >= 300 && response.status < 400) return error(502, 'UPSTREAM_UNAVAILABLE')
    const value: unknown = JSON.parse(await boundedBody(response.body, MAX_RESPONSE_BYTES))
    if (!value || typeof value !== 'object' || !publicData(value)) return error(502, 'INVALID_UPSTREAM_RESPONSE')
    return Response.json(value, { status: response.status, headers })
  } catch { return error(502, 'UPSTREAM_UNAVAILABLE') }
}
