import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleOrdersRequest, MAX_REQUEST_BYTES, ORDER_IO_TIMEOUT_MS } from '../src/http.ts'
import type { OrdersService } from '../src/service.ts'
afterEach(() => vi.useRealTimers())
const request = (body: ReadableStream<Uint8Array>): Request => new Request('https://orders.test/v1/orders', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half',
} as RequestInit & { duplex: 'half' })
describe('bounded order body input', () => {
  it('echoes only explicitly allowed origins including the new Soda domain', async () => {
    const service = { config: { publicOrigin: 'https://orders.test', additionalPublicOrigins: ['https://soda.ignix.bot'] }, status: async () => ({ ready: true }) } as unknown as OrdersService
    for (const origin of ['https://orders.test', 'https://soda.ignix.bot']) {
      const response = await handleOrdersRequest(new Request('https://orders.test/v1/status', { headers: { Origin: origin } }), service)
      expect(response.status).toBe(200); expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    }
    expect((await handleOrdersRequest(new Request('https://orders.test/v1/status', { headers: { Origin: 'https://attacker.example' } }), service)).status).toBe(403)
  })
  it('cancels an unfinished body at the existing network deadline without entering application work', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(), accept = vi.fn(), run = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ cancel })
    const service = { config: { publicOrigin: 'https://orders.test' }, accept } as unknown as OrdersService
    const pending = handleOrdersRequest(request(stream), service, run)
    await vi.advanceTimersByTimeAsync(ORDER_IO_TIMEOUT_MS)
    const response = await pending
    expect(response.status).toBe(408); expect(await response.json()).toMatchObject({ code: 'BODY_TIMEOUT' })
    expect(cancel).toHaveBeenCalledOnce(); expect(accept).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled()
  })
  it('does not restart the deadline when a client drips another chunk', async () => {
    vi.useFakeTimers()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    const service = { config: { publicOrigin: 'https://orders.test' } } as unknown as OrdersService
    const pending = handleOrdersRequest(request(stream), service)
    await vi.advanceTimersByTimeAsync(ORDER_IO_TIMEOUT_MS / 2)
    controller.enqueue(new TextEncoder().encode('{'))
    await vi.advanceTimersByTimeAsync(ORDER_IO_TIMEOUT_MS / 2)
    expect((await pending).status).toBe(408)
  })
  it('returns the size error even when the stream cancellation does not complete', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(MAX_REQUEST_BYTES + 1)) },
      cancel: () => new Promise<void>(() => {}),
    })
    const service = { config: { publicOrigin: 'https://orders.test' } } as unknown as OrdersService
    expect((await handleOrdersRequest(request(stream), service)).status).toBe(413)
  })
})
