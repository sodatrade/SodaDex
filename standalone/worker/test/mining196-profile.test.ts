import { describe, expect, it, vi } from 'vitest'
import { networkProfile } from '../../network-profile'
import { MINING_PRODUCTS, type MiningProductDeployment } from '../../mining-products'
import { actorName, baseConfig } from '../src/chain-index/config'
import worker from '../src/index'
const d = { ...MINING_PRODUCTS, chainId: 196, profileId: '196-mining-test' } as MiningProductDeployment
const env = { MINING_196_DEPLOYMENT: JSON.stringify(d) }
describe('196 mining private routing', () => {
  it('does not inherit 196 DEX capabilities or 1952 addresses', () => {
    expect(networkProfile('196-mining-test')).toMatchObject({ chainId: 196, dexEnabled: false, ordersEnabled: false, referenceEnabled: false })
    expect(() => baseConfig('196-mining-test')).toThrow('unavailable')
    const config = baseConfig('196-mining-test', env)
    expect(config.sources.every(s => s.protocol === 'mining')).toBe(true)
    expect(actorName(config)).toContain(':196-mining-test:')
    expect(actorName(config)).not.toBe(actorName(baseConfig('196-test')))
  })
  it('never calls the existing service when the new binding or deployment is missing', async () => {
    const legacy = vi.fn(), assets = vi.fn()
    for (const extra of [{}, env]) {
      const response = await worker.fetch(new Request('https://test.example/api/mining/status'), {
        ASSETS: { fetch: assets }, SODADEX_NETWORK_PROFILE: '196-mining-test', MINING_API: { fetch: legacy }, ...extra,
      })
      expect(response.status).toBe(503)
    }
    expect(legacy).not.toHaveBeenCalled(); expect(assets).not.toHaveBeenCalled()
  })
  it('binds new service requests to profile and deployment and rejects wrong-chain responses', async () => {
    const legacy = vi.fn(), isolated = vi.fn(async (request: Request) => {
      expect(request.headers.get('X-SodaDEX-Network-Profile')).toBe('196-mining-test')
      return Response.json({ schemaVersion: 1, chainId: 1952, deploymentVersion: d.version })
    })
    const response = await worker.fetch(new Request('https://test.example/api/mining/status'), {
      ASSETS: { fetch: vi.fn() }, SODADEX_NETWORK_PROFILE: '196-mining-test', MINING_API: { fetch: legacy }, MINING_API_196: { fetch: isolated }, ...env,
    })
    expect(response.status).toBe(503); expect(isolated).toHaveBeenCalledOnce(); expect(legacy).not.toHaveBeenCalled()
  })
  it('fails closed on malformed manifest and disabled DEX routes', async () => {
    const assets = { fetch: vi.fn() }
    expect((await worker.fetch(new Request('https://test.example/api/network'), { ASSETS: assets, SODADEX_NETWORK_PROFILE: '196-mining-test', MINING_196_DEPLOYMENT: '{' })).status).toBe(503)
    for (const path of ['orders/status', 'dex/pools', 'reference/tokens'])
      expect((await worker.fetch(new Request(`https://test.example/api/${path}`), { ASSETS: assets, SODADEX_NETWORK_PROFILE: '196-mining-test' })).status).toBe(503)
  })
})
