import { describe, expect, it, vi } from 'vitest'
import { networkProfile } from '../../network-profile'
import worker from '../src/index'
import { proxyRpc } from '../src/rpc'

const mining = networkProfile('1952-mining-test')
const req = (method: string, params: unknown[] = [], profile?: string): Request => new Request('https://soda.example/api/rpc', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(profile ? { 'X-SodaDEX-Network-Profile': profile } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params }),
})
const reply = (id: string | number, result: unknown): Response => Response.json({ jsonrpc: '2.0', id, result })

describe('independent test network profiles', () => {
  it('preserves the 196 default and never accepts an unknown profile or RPC URL', () => {
    expect(networkProfile()).toMatchObject({ id: '196-test', chainId: 196, rpcUrl: 'https://rpc.ignix.bot/rpc/196', dexEnabled: true })
    expect(mining).toMatchObject({ chainId: 1952, chainHex: '0x7a0', dexEnabled: false, ordersEnabled: false, referenceEnabled: false })
    for (const value of ['', '1952', 'production', 'https://rpc.example', null]) expect(() => networkProfile(value)).toThrow()
  })

  it('uses only the 1952 RPC, checking its chain before reading a test balance', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValueOnce(reply('network-profile', '0x7a0')).mockResolvedValueOnce(reply(7, '0x2'))
    const response = await proxyRpc(req('eth_getBalance', ['0x1111111111111111111111111111111111111111', 'latest']), upstream, mining)
    expect(await response.json()).toMatchObject({ result: '0x2' })
    expect(upstream.mock.calls.map(([url]) => url)).toEqual([mining.rpcUrl, mining.rpcUrl])
    expect(upstream.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).method)).toEqual(['eth_chainId', 'eth_getBalance'])
  })

  it('stops before balance reads if the configured RPC returns mainnet', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(reply('network-profile', '0xc4'))
    expect((await proxyRpc(req('eth_getBalance', ['0x1111111111111111111111111111111111111111', 'latest']), upstream, mining)).status).toBe(502)
    expect(upstream).toHaveBeenCalledOnce()
  })

  it('rejects a frontend/Worker profile mismatch without contacting any node', async () => {
    const upstream = vi.fn<typeof fetch>()
    expect((await proxyRpc(req('eth_chainId', [], '196-test'), upstream, mining)).status).toBe(409)
    expect(upstream).not.toHaveBeenCalled()
  })

  it.each(['196-test', '1952-mining-test'] as const)('rejects the wrong eth_chainId result for %s', async (id) => {
    const profile = networkProfile(id)
    expect((await proxyRpc(req('eth_chainId'), vi.fn<typeof fetch>().mockResolvedValue(reply(7, '0x1')), profile)).status).toBe(502)
  })

  it.each([
    ['eth_call', [{ to: '0xe538905cf8410324e03A5A23C1c177a474D59b2b', data: '0x313ce567' }, 'latest']],
    ['eth_estimateGas', [{ to: '0xe538905cf8410324e03A5A23C1c177a474D59b2b', data: '0x313ce567' }]],
    ['eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x2' }]],
    ['eth_sendRawTransaction', ['0x1234']],
  ] as const)('does not borrow mainnet contract validation for %s', async (method, params) => {
    const upstream = vi.fn<typeof fetch>()
    expect((await proxyRpc(req(method, [...params]), upstream, mining)).status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('does not forward mining profile orders, DEX data or official mainnet reference requests', async () => {
    const assets = vi.fn(), orders = vi.fn()
    for (const path of ['/api/orders', '/api/orders/status', '/api/dex/pools', '/api/reference/tokens']) {
      const response = await worker.fetch(new Request(`https://soda.example${path}`), {
        ASSETS: { fetch: assets }, ORDERS_API: { fetch: orders }, SODADEX_NETWORK_PROFILE: mining.id,
      })
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ chainId: 1952 })
    }
    expect(orders).not.toHaveBeenCalled(); expect(assets).not.toHaveBeenCalled()
  })

  it('reports explicit readiness and refuses invalid server configuration', async () => {
    const assets = vi.fn()
    const response = await worker.fetch(new Request('https://soda.example/api/network'), { ASSETS: { fetch: assets }, SODADEX_NETWORK_PROFILE: mining.id })
    expect(await response.json()).toMatchObject({ id: mining.id, chainId: 1952, dexEnabled: false, ordersEnabled: false })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect((await worker.fetch(new Request('https://soda.example/'), { ASSETS: { fetch: assets }, SODADEX_NETWORK_PROFILE: 'invalid' })).status).toBe(503)
    expect(assets).not.toHaveBeenCalled()
  })
})
