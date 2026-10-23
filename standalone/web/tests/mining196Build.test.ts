import { afterEach, describe, expect, it, vi } from 'vitest'
import { miningTestDeployment } from './fixtures/miningProducts'
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules() })
describe('explicit mining build identity', () => {
  it('boots with a pending empty 196 deployment rather than borrowing 1952 contracts', async () => {
    vi.resetModules(); vi.stubEnv('VITE_SODADEX_NETWORK_PROFILE', '196-mining-test')
    vi.stubGlobal('__MINING_196_DEPLOYMENT__', { schemaVersion: 1, chainId: 196, profileId: '196-mining-test', state: 'pending' })
    const { MINING_PRODUCTS } = await import('../src/mining/deployment')
    expect((await import('../src/mining/deployment')).MINING_NATIVE_SYMBOL).toBe('OKB')
    expect(MINING_PRODUCTS).toEqual({ chainId: 196, profileId: '196-mining-test', state: 'pending' })
    const { miningMessages } = await import('../src/mining/messages')
    expect(miningMessages('zh-CN').testAssetNote).toContain('真实 OKB')
    expect(miningMessages('en').testAssetNote).toContain('real OKB')
  })
  it('rejects a 1952 manifest supplied to the 196 build', async () => {
    vi.resetModules(); vi.stubEnv('VITE_SODADEX_NETWORK_PROFILE', '196-mining-test')
    vi.stubGlobal('__MINING_196_DEPLOYMENT__', miningTestDeployment())
    await expect(import('../src/mining/deployment')).rejects.toThrow('profile mismatch')
  })
})
