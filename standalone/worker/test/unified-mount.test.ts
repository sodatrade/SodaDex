import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
const url = 'https://soda.ignix.bot'
afterEach(() => vi.unstubAllGlobals())
describe('retired mining entrypoints', () => {
  it('keeps the DEX network and assets while refusing old mounted and direct mining APIs', async () => {
    const assets = vi.fn(async () => new Response('DEX')), binding = vi.fn()
    const env = { ASSETS: { fetch: assets }, MINING_API: { fetch: binding }, MINING_API_196: { fetch: binding } }
    expect(await (await worker.fetch(new Request(url + '/api/network'), env)).json()).toMatchObject({ id: '196-test', chainId: 196, dexEnabled: true })
    expect(await (await worker.fetch(new Request(url), env)).text()).toBe('DEX')
    for (const path of ['/mining', '/mining/', '/mining/api/rpc', '/mining/assets/old.js', '/api/mining', '/api/mining/status', '/api/mining/run']) {
      const response = await worker.fetch(new Request(url + path), env)
      expect(response.status).toBe(410); expect(await response.json()).toMatchObject({ code: 'MINING_RETIRED' })
    }
    expect(assets).toHaveBeenCalledOnce(); expect(binding).not.toHaveBeenCalled()
  })
  it('does not read a body or reach any service for retired write requests', async () => {
    const assets = vi.fn(), binding = vi.fn()
    for (const path of ['/api/mining/launch', '/mining/api/mining/run'])
      expect((await worker.fetch(new Request(url + path, { method: 'POST' }), { ASSETS: { fetch: assets }, MINING_API: { fetch: binding } })).status).toBe(410)
    expect(binding).not.toHaveBeenCalled(); expect(assets).not.toHaveBeenCalled()
  })
  it('does not permit headers to switch the DEX route to a retired chain', async () => {
    const upstream = vi.fn(); vi.stubGlobal('fetch', upstream)
    const response = await worker.fetch(new Request(url + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SodaDEX-Network-Profile': '1952-mining-test' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) }), { ASSETS: { fetch: vi.fn() } })
    expect(response.status).toBe(409); expect(upstream).not.toHaveBeenCalled()
  })
})
