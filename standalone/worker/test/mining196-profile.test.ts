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
  it('retires legacy profiles before assets, RPCs or service bindings can run', async () => {
    const legacy = vi.fn(), isolated = vi.fn(), assets = vi.fn()
    for (const id of ['1952-mining-test', '196-mining-test']) {
      for (const path of ['/', '/api/network', '/api/mining/status', '/api/rpc', '/api/orders/status', '/api/dex/pools']) {
        const response = await worker.fetch(new Request('https://test.example' + path), {
          ASSETS: { fetch: assets }, SODADEX_NETWORK_PROFILE: id, MINING_API: { fetch: legacy }, MINING_API_196: { fetch: isolated }, ...env,
        })
        expect(response.status).toBe(410); expect(await response.json()).toMatchObject({ code: 'MINING_RETIRED' })
      }
    }
    expect(legacy).not.toHaveBeenCalled(); expect(isolated).not.toHaveBeenCalled(); expect(assets).not.toHaveBeenCalled()
  })
})
