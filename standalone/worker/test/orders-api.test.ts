import { encodeFunctionData, parseAbi, type Hex } from 'viem'
import { describe, expect, it, vi } from 'vitest'
// This boundary test must never inherit the current cloud service from a release manifest.
vi.mock('../src/order-config', () => ({ ORDER_DEPLOYMENT: undefined }))
import { ordersApi } from '../src/orders-api'
import { validOrderRequest } from '../src/order-requests'
import { validContractRequest } from '../src/trade-requests'
const maker = '0x2222222222222222222222222222222222222222'
const configured = { chainId: 196, settlement: '0x1111111111111111111111111111111111111111', deploymentBlock: 1, apiOrigin: 'https://orders.example.com', executionEnabled: true } as const
const abi = parseAbi(['function nonceStatus(address,uint256) view returns(uint8)', 'function cancel(uint256)', 'function execute(bytes)'])
const request = (path: string, init?: RequestInit): Request => new Request(`https://soda.example.com/api/orders${path}`, init)
describe('fixed order service boundary', () => {
  it('reports pending deployment without calling an upstream or accepting orders', async () => {
    const upstream = vi.fn()
    expect(await (await ordersApi(request('/status'), upstream)).json()).toMatchObject({ acceptingOrders: false, executionEnabled: false, reason: 'NOT_DEPLOYED', settlement: null })
    expect((await ordersApi(request(`?maker=${maker}`), upstream)).status).toBe(503)
    expect(upstream).not.toHaveBeenCalled()
  })
  it('proxies only the fixed service origin and approved route', async () => {
    const upstream = vi.fn(async () => Response.json({ schemaVersion: 1, orders: [], nextCursor: null }))
    const response = await ordersApi(request(`?maker=${maker}&limit=20&cursor=2`), upstream, configured)
    expect(response.status).toBe(200)
    const [url, init] = upstream.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.origin).toBe(configured.apiOrigin); expect(url.pathname).toBe('/v1/orders')
    expect(init.redirect).toBe('manual'); expect(init.headers).toMatchObject({ Origin: 'https://soda.example.com' })
    for (const path of ['/../../anything', '?maker=bad', `?maker=${maker}&rpc=https://evil.example`, `?maker=${maker}&maker=${maker}`, `?maker=${maker}&limit=101`])
      expect((await ordersApi(request(path), upstream, configured)).ok).toBe(false)
    expect(upstream).toHaveBeenCalledTimes(1)
  })
  it('blocks cross-origin writes, redirects, oversized bodies and private service fields', async () => {
    const upstream = vi.fn(async () => Response.json({ signature: 'secret' }))
    const post = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    expect((await ordersApi(request('', { ...post, headers: { ...post.headers, Origin: 'https://evil.example' } }), upstream, configured)).status).toBe(403)
    expect((await ordersApi(request('', { ...post, body: 'x'.repeat(16385) }), upstream, configured)).status).toBe(413)
    expect(upstream).not.toHaveBeenCalled()
    expect((await ordersApi(request('', post), upstream, configured)).status).toBe(502)
    const redirect = vi.fn(async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }))
    expect((await ordersApi(request('/status'), redirect, configured)).status).toBe(502)
  })
  it('admits only canonical nonce reads and maker cancellations for the active settlement', () => {
    const read = encodeFunctionData({ abi, functionName: 'nonceStatus', args: [maker, 1n] })
    const cancel = encodeFunctionData({ abi, functionName: 'cancel', args: [1n] })
    expect(validOrderRequest(configured.settlement, read, undefined, 0n, false, configured)).toBe(true)
    expect(validOrderRequest(configured.settlement, read, undefined, 0n, true, configured)).toBe(false)
    expect(validOrderRequest(configured.settlement, cancel, maker, 0n, true, configured)).toBe(true)
    for (const data of [`${cancel}00` as Hex, encodeFunctionData({ abi, functionName: 'execute', args: ['0x'] })])
      expect(validOrderRequest(configured.settlement, data, maker, 0n, false, configured)).toBe(false)
    expect(validOrderRequest(configured.settlement, cancel, undefined, 0n, true, configured)).toBe(false)
    expect(validOrderRequest(maker, cancel, maker, 0n, true, configured)).toBe(false)
    expect(validOrderRequest(configured.settlement, cancel, maker, 1n, true, configured)).toBe(false)
    expect(validContractRequest({ from: maker, to: configured.settlement, data: cancel, value: '0x0' }, true)).toBe(false)
  })
  it('retains history, nonce reads and cancellations when new orders are paused', async () => {
    const paused = { ...configured, executionEnabled: false }
    const upstream = vi.fn(async () => Response.json({ schemaVersion: 1, orders: [], nextCursor: null }))
    expect((await ordersApi(request(`?maker=${maker}`), upstream, paused)).status).toBe(200)
    expect((await ordersApi(request('', { method: 'POST' }), upstream, paused)).status).toBe(503)
    expect(upstream).toHaveBeenCalledTimes(1)
    const read = encodeFunctionData({ abi, functionName: 'nonceStatus', args: [maker, 1n] })
    const cancel = encodeFunctionData({ abi, functionName: 'cancel', args: [1n] })
    expect(validOrderRequest(configured.settlement, read, undefined, 0n, false, paused)).toBe(true)
    expect(validOrderRequest(configured.settlement, cancel, maker, 0n, true, paused)).toBe(true)
  })
})
