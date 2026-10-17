import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Hex } from 'viem'
import { NonceConflict } from './store.ts'
import { ServiceError, OrdersService } from './service.ts'
const MAX_BYTES = 16_384
function json(response: ServerResponse, status: number, payload: object): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(JSON.stringify(payload))
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new ServiceError(415, 'JSON_REQUIRED', 'JSON required')
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += bytes.length
    if (size > MAX_BYTES) { request.resume(); throw new ServiceError(413, 'BODY_TOO_LARGE', 'Order request is too large') }
    chunks.push(bytes)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ServiceError(400, 'VALIDATION_FAILED', 'Invalid JSON') }
}
export function createOrdersServer(service: OrdersService): Server {
  return createServer((request, response) => {
    const handle = async (): Promise<void> => {
      const origin = request.headers.origin
      if (origin && origin !== service.config.publicOrigin) throw new ServiceError(403, 'ORIGIN_FORBIDDEN', 'Origin not allowed')
      if (origin) { response.setHeader('Access-Control-Allow-Origin', service.config.publicOrigin); response.setHeader('Vary', 'Origin') }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' }); response.end(); return
      }
      const url = new URL(request.url ?? '/', 'http://orders.local')
      if (url.pathname === '/v1/status' && request.method === 'GET') { json(response, 200, await service.status()); return }
      if (url.pathname === '/v1/orders' && request.method === 'POST') {
        if (url.search) throw new ServiceError(400, 'VALIDATION_FAILED', 'Unexpected query parameters')
        const result = await service.accept(await body(request))
        json(response, result.created ? 201 : 200, { schemaVersion: 1, order: result.order }); return
      }
      if (url.pathname === '/v1/orders' && request.method === 'GET') {
        const maker = url.searchParams.get('maker'), limit = url.searchParams.get('limit') ?? '50', cursor = url.searchParams.get('cursor')
        if ([...url.searchParams.keys()].some(key => !['maker', 'limit', 'cursor'].includes(key) || url.searchParams.getAll(key).length !== 1) || !maker || !/^0x[0-9a-fA-F]{40}$/.test(maker) || !/^[1-9][0-9]*$/.test(limit) || Number(limit) > 100 || (cursor !== null && !/^[1-9][0-9]{0,18}$/.test(cursor))) throw new ServiceError(400, 'VALIDATION_FAILED', 'Invalid maker or pagination')
        json(response, 200, { schemaVersion: 1, ...await service.list(maker, Number(limit), cursor ?? undefined) }); return
      }
      const match = /^\/v1\/orders\/(0x[0-9a-fA-F]{64})$/.exec(url.pathname)
      if (match && request.method === 'GET' && !url.search) {
        const order = await service.get(match[1].toLowerCase() as Hex)
        if (!order) throw new ServiceError(404, 'NOT_FOUND', 'Order not found')
        json(response, 200, { schemaVersion: 1, order }); return
      }
      throw new ServiceError(405, 'METHOD_NOT_ALLOWED', 'Only order submission and public reads are supported; cancellation requires a wallet transaction')
    }
    void handle().catch(error => {
      if (error instanceof ServiceError) json(response, error.status, { error: error.message, code: error.code })
      else if (error instanceof NonceConflict) json(response, 409, { error: 'Maker nonce already belongs to another order', code: 'NONCE_CONFLICT' })
      else json(response, 503, { error: 'Order service temporarily unavailable', code: 'CHAIN_UNAVAILABLE' })
    })
  })
}
