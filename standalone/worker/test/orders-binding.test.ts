import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ ordersApi: vi.fn<(request: Request, upstream?: typeof fetch) => Promise<Response>>(async () => Response.json({ service: 'bound-orders' })) }))
vi.mock('../src/orders-api', () => ({ ordersApi: mocks.ordersApi }))
import worker from '../src/index'
afterEach(() => vi.clearAllMocks())
it('routes the order request through the configured service binding', async () => {
  const bound = { fetch: vi.fn(async () => Response.json({ bound: true })) }
  const request = new Request('https://preview.test/api/orders/status')
  const response = await worker.fetch(request, { ASSETS: { fetch: vi.fn() }, ORDERS_API: bound })
  expect(await response.json()).toEqual({ service: 'bound-orders' })
  expect(mocks.ordersApi).toHaveBeenCalledOnce()
  expect(mocks.ordersApi.mock.calls[0]?.[0]).toBe(request)
  const transport = mocks.ordersApi.mock.calls[0]?.[1]
  await transport?.('https://reviewed-orders.test/v1/status')
  expect(bound.fetch).toHaveBeenCalledWith('https://reviewed-orders.test/v1/status')
})
