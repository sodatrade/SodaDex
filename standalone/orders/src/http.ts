import type { Hex } from 'viem'
import { NonceConflict } from './repository.ts'
import { ServiceError, type OrdersService } from './service.ts'
export const MAX_REQUEST_BYTES = 16_384
function json(status: number, payload: object, headers = new Headers()): Response {
  headers.set('Content-Type', 'application/json'); headers.set('Cache-Control', 'no-store'); headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(JSON.stringify(payload), { status, headers })
}
export function ordersError(error: unknown, headers = new Headers()): Response {
  if (error instanceof ServiceError) return json(error.status, { error: error.message, code: error.code }, headers)
  if (error instanceof NonceConflict) return json(409, { error: 'Maker nonce already belongs to another order', code: 'NONCE_CONFLICT' }, headers)
  return json(503, { error: 'Order service temporarily unavailable', code: 'CHAIN_UNAVAILABLE' }, headers)
}
async function body(request: Request): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new ServiceError(415, 'JSON_REQUIRED', 'JSON required')
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []
  let size = 0
  if (reader) {
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > MAX_REQUEST_BYTES) { await reader.cancel(); throw new ServiceError(413, 'BODY_TOO_LARGE', 'Order request is too large') }
        chunks.push(chunk.value)
      }
    } finally { reader.releaseLock() }
  }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new ServiceError(400, 'VALIDATION_FAILED', 'Invalid JSON') }
}
export async function handleOrdersRequest(request: Request, service: OrdersService): Promise<Response> {
  const headers = new Headers()
  try {
      const origin = request.headers.get('Origin')
      if (origin && origin !== service.config.publicOrigin) throw new ServiceError(403, 'ORIGIN_FORBIDDEN', 'Origin not allowed')
      if (origin) { headers.set('Access-Control-Allow-Origin', service.config.publicOrigin); headers.set('Vary', 'Origin') }
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { ...Object.fromEntries(headers), 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } })
      }
      const url = new URL(request.url)
      if (url.pathname === '/v1/status' && request.method === 'GET') { return json(200, await service.status(), headers) }
      if (url.pathname === '/v1/orders' && request.method === 'POST') {
        if (url.search) throw new ServiceError(400, 'VALIDATION_FAILED', 'Unexpected query parameters')
        const result = await service.accept(await body(request))
        return json(result.created ? 201 : 200, { schemaVersion: 1, order: result.order }, headers)
      }
      if (url.pathname === '/v1/orders' && request.method === 'GET') {
        const maker = url.searchParams.get('maker'), limit = url.searchParams.get('limit') ?? '50', cursor = url.searchParams.get('cursor')
        if ([...url.searchParams.keys()].some(key => !['maker', 'limit', 'cursor'].includes(key) || url.searchParams.getAll(key).length !== 1) || !maker || !/^0x[0-9a-fA-F]{40}$/.test(maker) || !/^[1-9][0-9]*$/.test(limit) || Number(limit) > 100 || (cursor !== null && !/^[1-9][0-9]{0,18}$/.test(cursor))) throw new ServiceError(400, 'VALIDATION_FAILED', 'Invalid maker or pagination')
        return json(200, { schemaVersion: 1, ...await service.list(maker, Number(limit), cursor ?? undefined) }, headers)
      }
      const match = /^\/v1\/orders\/(0x[0-9a-fA-F]{64})$/.exec(url.pathname)
      if (match && request.method === 'GET' && !url.search) {
        const order = await service.get(match[1].toLowerCase() as Hex)
        if (!order) throw new ServiceError(404, 'NOT_FOUND', 'Order not found')
        return json(200, { schemaVersion: 1, order }, headers)
      }
      throw new ServiceError(405, 'METHOD_NOT_ALLOWED', 'Only order submission and public reads are supported; cancellation requires a wallet transaction')

  } catch (error) { return ordersError(error, headers) }
}
