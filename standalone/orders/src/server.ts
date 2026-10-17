import { createServer, type IncomingMessage, type Server } from 'node:http'
import { MAX_REQUEST_BYTES, handleOrdersRequest, ordersError } from './http.ts'
import { ServiceError, type OrdersService } from './service.ts'
async function collect(request: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += bytes.length
    if (size > MAX_REQUEST_BYTES) { request.resume(); throw new ServiceError(413, 'BODY_TOO_LARGE', 'Order request is too large') }
    chunks.push(bytes)
  }
  return new Uint8Array(Buffer.concat(chunks))
}
export function createOrdersServer(service: OrdersService): Server {
  return createServer((incoming, outgoing) => {
    const handle = async (): Promise<void> => {
      let response: Response
      try {
        const body = await collect(incoming)
        const headers = new Headers()
        for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
        response = await handleOrdersRequest(new Request(new URL(incoming.url ?? '/', 'http://orders.local'), { method: incoming.method, headers, body }), service)
      } catch (error) { response = ordersError(error) }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()))
    }
    void handle().catch(() => { outgoing.writeHead(503); outgoing.end() })
  })
}
