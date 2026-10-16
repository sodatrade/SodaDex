import { afterEach, describe, expect, it, vi } from 'vitest'
import { WOKB_ADDRESS } from '../src/domain/assets'
import { getBalances, getNetworkStatus } from '../src/lib/rpc'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('read-only same-origin data', () => {
  it('checks chain identity before trusting a block number', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: '0x1' })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(getNetworkStatus()).rejects.toThrow('网络与 X Layer 不一致')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('reads native and wrapped balances using the verified contract', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: unknown, options: RequestInit) => {
      const request = JSON.parse(String(options.body)) as { method: string }
      return new Response(JSON.stringify({ result: request.method === 'eth_getBalance' ? '0x2' : '0x3' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const address = '0x1111111111111111111111111111111111111111'
    expect(await getBalances(address)).toEqual({ okb: 2n, wokb: 3n, usdt0: 3n })
    expect(fetchMock.mock.calls.every(([url]) => url === '/api/rpc')).toBe(true)
    const calls = fetchMock.mock.calls.map(([, options]) => JSON.parse(String(options.body)))
    expect(calls[1]).toMatchObject({
      method: 'eth_call',
      params: [{ to: WOKB_ADDRESS, data: `0x70a08231${address.slice(2).padStart(64, '0')}` }, 'latest'],
    })
  })
  it('fails visibly on unavailable RPC instead of inventing balances', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    await expect(getBalances('0x1111111111111111111111111111111111111111')).rejects.toThrow('暂时无法连接')
  })
})
