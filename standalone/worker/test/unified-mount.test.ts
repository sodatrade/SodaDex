import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { MINING_PRODUCTS } from '../../mining-products'
const assets = vi.fn(async (req: Request) => new Response(new URL(req.url).pathname))
const env = { ASSETS: { fetch: assets }, SODADEX_MINING_MOUNT: 'enabled' }
const url = 'https://sodadex-preview.jsmsdx2025.workers.dev'
afterEach(() => vi.unstubAllGlobals())
describe('same-origin mining mount', () => {
  it('serves two fixed profiles without changing the existing mainnet endpoint', async () => {
    for (const [path, id, chain] of [['/api/network', '196-test', 196], ['/mining/api/network', '1952-mining-test', 1952]] as const) {
      expect(await (await worker.fetch(new Request(url + path), env)).json()).toMatchObject({ id, chainId: chain })
    }
    const redirect = await worker.fetch(new Request(url + '/mining'), env)
    expect(redirect.status).toBe(308); expect(redirect.headers.get('location')).toBe(url + '/mining/')
    expect(await (await worker.fetch(new Request(url + '/mining/'), env)).text()).toBe('/mining/')
  })
  it('requires explicit server enablement and refuses nested paths instead of serving the DEX fallback', async () => {
    expect((await worker.fetch(new Request(url + '/mining/'), { ASSETS: { fetch: assets } })).status).toBe(404)
    expect((await worker.fetch(new Request(url + '/mining/missing'), env)).status).toBe(404)
    expect((await worker.fetch(new Request(url + '/mining/api/unknown'), env)).status).toBe(404)
  })
  it('blocks orders, DEX and reference endpoints inside the mining profile', async () => {
    const orders = vi.fn()
    for (const path of ['orders/status', 'dex/pools', 'reference/tokens']) {
      const res = await worker.fetch(new Request(`${url}/mining/api/${path}`), { ...env, ORDERS_API: { fetch: orders } })
      expect(res.status).toBe(503)
      expect(await res.json()).toMatchObject({ chainId: 1952 })
    }
    expect(orders).not.toHaveBeenCalled()
  })
  it('does not permit headers to switch a route to the opposite chain', async () => {
    const upstream = vi.fn(); vi.stubGlobal('fetch', upstream)
    for (const [path, profile] of [['/api/rpc', '1952-mining-test'], ['/mining/api/rpc', '196-test']]) {
      const res = await worker.fetch(new Request(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SodaDEX-Network-Profile': profile },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) }), env)
      expect(res.status).toBe(409)
    }
    expect(upstream).not.toHaveBeenCalled()
  })
  it('preserves the real site origin when forwarding to the existing private service', async () => {
    const binding = vi.fn(async (_request: Request) => Response.json({ schemaVersion: 1, chainId: 1952, deploymentVersion: MINING_PRODUCTS.state === 'ready' ? MINING_PRODUCTS.version : '', projects: [], revision: '1' }))
    const res = await worker.fetch(new Request(url + '/mining/api/mining/projects'), { ...env, MINING_API: { fetch: binding } })
    expect(res.status).toBe(200)
    expect(binding.mock.calls[0][0].headers.get('Origin')).toBe(url)
    const external = await worker.fetch(new Request(url + '/mining/api/mining/projects', { headers: { Origin: 'https://external.example' } }), { ...env, MINING_API: { fetch: binding } })
    expect(external.status).toBe(403); expect(binding).toHaveBeenCalledOnce()
    expect((await worker.fetch(new Request(url + '/api/mining/projects'), { ...env, MINING_API: { fetch: binding } })).status).toBe(503)
  })
  it('selects the 196 TEST mount explicitly and uses only its isolated backend', async () => {
    const deployment = { ...MINING_PRODUCTS, chainId: 196, profileId: '196-mining-test' }
    const legacy = vi.fn(), isolated = vi.fn(async () => Response.json({ schemaVersion: 1, chainId: 196,
      deploymentVersion: MINING_PRODUCTS.state === 'ready' ? MINING_PRODUCTS.version : '', projects: [], revision: '1' }))
    const selected = { ...env, SODADEX_MINING_MOUNT_PROFILE: '196-mining-test', MINING_196_DEPLOYMENT: JSON.stringify(deployment),
      MINING_API: { fetch: legacy }, MINING_API_196: { fetch: isolated } }
    expect(await (await worker.fetch(new Request(url + '/mining/api/network'), selected)).json()).toMatchObject({ id: '196-mining-test', chainId: 196 })
    expect(await (await worker.fetch(new Request(url + '/api/network'), selected)).json()).toMatchObject({ id: '196-test', dexEnabled: true })
    expect((await worker.fetch(new Request(url + '/mining/api/mining/projects'), selected)).status).toBe(200)
    expect(isolated).toHaveBeenCalledOnce(); expect(legacy).not.toHaveBeenCalled()
    expect((await worker.fetch(new Request(url + '/mining/api/mining/status'), { ...selected, MINING_196_DEPLOYMENT: undefined })).status).toBe(503)
  })
  it('does not fall back to 1952 for an invalid mounted profile', async () => {
    for (const profile of ['196-test', 'invalid', ''])
      expect((await worker.fetch(new Request(url + '/mining/api/network'), { ...env, SODADEX_MINING_MOUNT_PROFILE: profile })).status).toBe(503)
  })

})
