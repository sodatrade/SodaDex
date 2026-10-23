import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { networkProfile } from '../../network-profile'
import { readMiningPending } from '../src/mining-pending-rpc'
import { proxyRpc } from '../src/rpc'

const profile = networkProfile('1952-mining-test')
const address = '0x1111111111111111111111111111111111111111'
const rpc = { jsonrpc: '2.0' as const, id: 70, method: 'eth_call', params: [{ to: address, from: address, data: '0x' }, 'pending'] }
const header = (number: string): object => ({ number, timestamp: number })
function snapshot(stale = false, result: unknown = '0x1234', error?: object): Response {
  const values = ['0x7a0', header('0x10'), header(stale ? '0x1' : '0x11'), '0x6001', '0x6001', '0x2', '0x2']
  return Response.json([...values.map((value, id) => ({ jsonrpc: '2.0', id, result: value })),
    { jsonrpc: '2.0', id: values.length, ...(error ? { error } : { result }) }])
}
async function settle<T>(promise: Promise<T>): Promise<T> {
  const outcome = promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
  await vi.advanceTimersByTimeAsync(20_000)
  const result = await outcome
  if (!result.ok) throw result.error
  return result.value
}

describe('1952 pending snapshot transport', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(0)
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms)
      return controller.signal
    })
  })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })
  it('retries an obsolete backend and returns a fresh result with the client id', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValueOnce(snapshot(true)).mockResolvedValueOnce(snapshot())
    expect(await settle(readMiningPending(rpc, profile, upstream))).toEqual({ jsonrpc: '2.0', id: 70, result: '0x1234' })
    expect(upstream).toHaveBeenCalledTimes(2)
    const [url, options] = upstream.mock.calls[0]
    expect(url).toBe(profile.rpcUrl)
    expect(options?.redirect).toBe('manual')
    expect(JSON.parse(String(options?.body)).map((item: { method: string }) => item.method)).toEqual([
      'eth_chainId', 'eth_getBlockByNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getCode',
      'eth_getTransactionCount', 'eth_getTransactionCount', 'eth_call',
    ])
  })
  it('bounds retries without falling back to mainnet', async () => {
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => snapshot(true))
    await expect(settle(readMiningPending(rpc, profile, upstream))).rejects.toThrow('remained stale')
    expect(upstream).toHaveBeenCalledTimes(6)
    expect(upstream.mock.calls.every(([url]) => url === profile.rpcUrl)).toBe(true)
  })
  it('waits through a twelve-second stale backend and accepts its recovery', async () => {
    const attempts: number[] = []
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => {
      attempts.push(Date.now())
      return snapshot(Date.now() < 12_000)
    })
    expect(await settle(readMiningPending(rpc, profile, upstream))).toMatchObject({ result: '0x1234' })
    expect(attempts).toEqual([0, 1000, 3000, 7000, 11000, 15000])
  })
  it('aborts a hanging final read at the shared twenty-second deadline', async () => {
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (_, options) => {
      if (Date.now() < 15_000) return snapshot(true)
      return new Promise<Response>((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true }))
    })
    await expect(settle(readMiningPending(rpc, profile, upstream))).rejects.toThrow('Timed out')
    expect(upstream).toHaveBeenCalledTimes(6)
    expect(Date.now()).toBe(20_000)
  })
  it('stops during backoff when the shared deadline expires', async () => {
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 19_500))
      return snapshot(true)
    })
    await expect(settle(readMiningPending(rpc, profile, upstream))).rejects.toThrow('Timed out')
    expect(upstream).toHaveBeenCalledOnce()
  })
  it('preserves a fresh contract revert without retry', async () => {
    const error = { code: 3, message: 'execution reverted', data: '0xabcd' }
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(snapshot(false, undefined, error))
    expect(await settle(readMiningPending(rpc, profile, upstream))).toEqual({ jsonrpc: '2.0', id: 70, error })
    expect(upstream).toHaveBeenCalledOnce()
  })
  it.each(['code', 'nonce', 'malformed'] as const)('rejects stale or invalid %s probes before accepting a result', async (kind) => {
    const body = await snapshot().json() as { result?: unknown }[]
    if (kind === 'code') body[4].result = '0x'
    if (kind === 'nonce') body[6].result = '0x0'
    if (kind === 'malformed') body[1].result = { number: 'invalid' }
    const upstream = vi.fn<typeof fetch>().mockImplementationOnce(async () => Response.json(body)).mockImplementation(async () => snapshot())
    expect(await settle(readMiningPending(rpc, profile, upstream))).toMatchObject({ result: '0x1234' })
    expect(upstream).toHaveBeenCalledTimes(2)
  })
  it('allows legitimate user transactions in the mempool', async () => {
    const body = await snapshot().json() as { result?: unknown }[]
    body[6].result = '0x3'
    expect(await settle(readMiningPending(rpc, profile, vi.fn<typeof fetch>().mockResolvedValue(Response.json(body))))).toMatchObject({ result: '0x1234' })
  })
  it('rejects wrong-chain batches and upstream redirects', async () => {
    const body = await snapshot().json() as { result?: unknown }[]
    body[0].result = '0xc4'
    await expect(settle(readMiningPending(rpc, profile, vi.fn<typeof fetch>().mockResolvedValue(Response.json(body))))).rejects.toThrow('network mismatch')
    const redirect = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302 }))
    await expect(settle(readMiningPending(rpc, profile, redirect))).rejects.toThrow('unavailable')
    expect(redirect).toHaveBeenCalledOnce()
  })
  it('guards public pending balance reads after the existing network gate', async () => {
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (_, options) => {
      const body: unknown = JSON.parse(String(options?.body))
      if (!Array.isArray(body)) return Response.json({ jsonrpc: '2.0', id: 'network-profile', result: '0x7a0' })
      return Response.json(['0x7a0', header('0x10'), header('0x11'), '0x1234'].map((result, id) => ({ jsonrpc: '2.0', id, result })))
    })
    const response = await proxyRpc(new Request('https://soda.example/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 70, method: 'eth_getBalance', params: [address, 'pending'] }) }), upstream, profile)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: 70, result: '0x1234' })
    expect(upstream).toHaveBeenCalledTimes(2)
  })
})
