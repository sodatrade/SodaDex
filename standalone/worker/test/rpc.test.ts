import { describe, expect, it, vi } from 'vitest'
import { proxyRpc, RPC_URL } from '../src/rpc'

const request = (body: unknown, headers: Record<string, string> = {}): Request => new Request('https://soda.example/api/rpc', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://soda.example', ...headers }, body: JSON.stringify(body),
})
const rpc = (method: string, params: unknown[] = []): object => ({ jsonrpc: '2.0', id: 7, method, params })
const success = (): Response => Response.json({ jsonrpc: '2.0', id: 7, result: '0xc4' })

describe('same-origin X Layer read proxy', () => {
  it('uses only the selected RPC and strips browser credentials and Origin', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(success())
    const response = await proxyRpc(request(rpc('eth_chainId'), { Authorization: 'browser-only', Cookie: 'session=browser-only' }), upstream)
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 7, result: '0xc4' })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(upstream).toHaveBeenCalledOnce()
    const [url, options] = upstream.mock.calls[0]
    expect(url).toBe(RPC_URL)
    expect(options?.headers).toEqual({ 'Content-Type': 'application/json', 'User-Agent': 'SodaDex/1.0' })
    expect(options?.redirect).toBe('manual')
  })

  it.each(['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'debug_traceCall'])('never forwards %s', async (method) => {
    const upstream = vi.fn<typeof fetch>()
    expect((await proxyRpc(request(rpc(method)), upstream)).status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('reads canonical ERC20 metadata and balances without arbitrary selectors', async () => {
    const upstream = vi.fn<typeof fetch>().mockImplementation(async () => success())
    const to = '0xe538905cf8410324e03A5A23C1c177a474D59b2b'
    const address = '0x6ecf746b078d46391f8C425B150153212F7C0545'
    const data = '0x70a08231' + address.slice(2).padStart(64, '0')
    expect((await proxyRpc(request(rpc('eth_call', [{ to, data }, 'latest'])), upstream)).status).toBe(200)
    expect((await proxyRpc(request(rpc('eth_call', [{ to, data: '0xa9059cbb' }, 'latest'])), upstream)).status).toBe(400)
    expect((await proxyRpc(request(rpc('eth_call', [{ to: address, data: '0x313ce567' }, 'latest'])), upstream)).status).toBe(200)
    expect((await proxyRpc(request(rpc('eth_call', [{ to, data, value: '0x1' }, 'latest'])), upstream)).status).toBe(400)
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it.each([
    [{ jsonrpc: '2.0', id: 7, result: '0xc4' }, 200],
    [{ jsonrpc: '2.0', id: 7, error: { code: -32000, message: 'execution reverted' } }, 200],
    [{ jsonrpc: '2.0', id: 8, result: '0xc4' }, 502],
    [{ result: '0xc4' }, 502],
    [{ jsonrpc: '2.0', id: 7, error: {} }, 502],
    [{ jsonrpc: '2.0', id: 7, result: '0xc4', error: { code: -32000, message: 'invalid' } }, 502],
  ])('preserves valid results/errors and rejects mismatched replies', async (result, status) => {
    const response = await proxyRpc(request(rpc('eth_chainId')), vi.fn<typeof fetch>().mockResolvedValue(Response.json(result)))
    expect(response.status).toBe(status)
  })

  it('returns unavailable when upstream rejects the request or times out', async () => {
    for (const upstream of [vi.fn<typeof fetch>().mockResolvedValue(new Response('private error', { status: 403 })), vi.fn<typeof fetch>().mockRejectedValue(new Error('network'))]) {
      const response = await proxyRpc(request(rpc('eth_chainId')), upstream)
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32000, message: 'RPC temporarily unavailable' } })
    }
  })

  it('does not follow an upstream redirect to another node', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'https://other.example' } }))
    expect((await proxyRpc(request(rpc('eth_chainId')), upstream)).status).toBe(502)
    expect(upstream).toHaveBeenCalledOnce()
    expect(upstream.mock.calls[0][1]?.redirect).toBe('manual')
  })

  it('rejects foreign origins, malformed parameters and oversized bodies without upstream access', async () => {
    const upstream = vi.fn<typeof fetch>()
    expect((await proxyRpc(request(rpc('eth_chainId'), { Origin: 'https://foreign.example' }), upstream)).status).toBe(403)
    expect((await proxyRpc(request(rpc('eth_getBalance', ['not-address', 'latest'])), upstream)).status).toBe(400)
    expect((await proxyRpc(request([rpc('eth_chainId')]), upstream)).status).toBe(400)
    expect((await proxyRpc(request({ ...rpc('eth_chainId'), padding: 'x'.repeat(17000) }), upstream)).status).toBe(413)
    expect((await proxyRpc(new Request('https://soda.example/api/rpc'), upstream)).status).toBe(405)
    expect(upstream).not.toHaveBeenCalled()
  })
})
