import { describe, expect, it } from 'vitest'
import { keccak256, parseTransaction, toHex } from 'viem'
import { miningDeploymentForProfile, parseMiningDeployment, type MiningProductDeployment } from '../../mining-products.ts'
import { miningCreateParams } from '../../mining-signed-calls.ts'
import { validateConfig } from '../src/config.ts'
import { cloudConfig } from '../cloudflare/config.ts'
import { launchPayload, purchaseTyped, conversionTyped, authorizationDigest } from '../src/signatures.ts'
import { validateRaw } from '../src/execution-policy.ts'
import { MemoryStorage, Repository } from '../src/repository.ts'
import { challengeMessage } from '../src/admission.ts'
import { authority, config, d, keeperAccount, wallet } from './fixture.ts'
const deployment: MiningProductDeployment = { ...d, chainId: 196, profileId: '196-mining-test' }
describe('196 mining test isolation', () => {
  it('requires explicit profile and manifest; missing addresses stay pending', () => {
    expect(miningDeploymentForProfile('196-mining-test')).toEqual({ chainId: 196, profileId: '196-mining-test', state: 'pending' })
    expect(() => parseMiningDeployment({ ...d, chainId: 196 })).toThrow()
    expect(() => miningDeploymentForProfile('196-mining-test', d)).toThrow()
    expect(parseMiningDeployment(deployment)).toEqual(deployment)
    expect(() => parseMiningDeployment({ ...deployment, contracts: {} })).toThrow()
  })
  it('does not inherit the 1952 signer, recovery permission or a live operating budget', () => {
    const c = { ...config(), chainId: 196 as const, profileId: '196-mining-test' as const, rpcUrl: 'https://rpc.ignix.bot/rpc/196', expectedSigner: authority.address }
    expect(validateConfig(c)).toEqual(c)
    expect(() => validateConfig({ ...c, profileId: undefined })).toThrow()
    expect(() => validateConfig({ ...c, expectedSigner: config().expectedSigner })).toThrow()
    expect(() => validateConfig({ ...c, rpcUrl: config().rpcUrl })).toThrow()
    expect(() => validateConfig({ ...c, expiredRecoveryHash: `0x${'11'.repeat(32)}` })).toThrow('recovery')
    const { config: disabled } = cloudConfig({ MINING_1952: {} as never, MINING_NETWORK_PROFILE: '196-mining-test', MINING_PUBLIC_ORIGIN: 'https://test.example', MINING_EXPECTED_SIGNER: authority.address })
    expect(disabled).toMatchObject({ chainId: 196, admissionEnabled: false, executionEnabled: false, gasCapWei: 0n, policy: null, keeperAddress: null })
  })
  it('cannot restore another chain ledger even if deployment version is identical', () => {
    const storage = new MemoryStorage(), old = new Repository(storage, d)
    old.change(s => { s.spentWei = '123'; s.reservedWei = '456' })
    expect(() => new Repository(storage, deployment)).toThrow('storage_deployment_mismatch')
    const isolated = new Repository(new MemoryStorage(), deployment)
    expect(isolated.read()).toMatchObject({ profileId: '196-mining-test', chainId: 196, spentWei: '0', reservedWei: '0' })
    expect(old.read()).toMatchObject({ spentWei: '123', reservedWei: '456' })
  })
  it('binds issuance and both typed authorizations to chain 196', () => {
    const form = { name: 'TEST Example', symbol: 'TEST-EX', metadataURI: '' }
    const params = miningCreateParams(form, keccak256(toHex('profile-196')), deployment)
    expect(launchPayload(deployment, wallet.address, params, 1300, 0, d.contracts.launchFactory.address))
      .not.toBe(launchPayload(d, wallet.address, params, 1300, 0, d.contracts.launchFactory.address))
    const purchase = { listingId: 1n, minerId: 2n, nativePrice: 1n, maxFab: 2n, nonce: 0n, deadline: 1300n }
    expect(authorizationDigest(purchaseTyped(d.contracts.farm.address, purchase, 196))).not.toBe(authorizationDigest(purchaseTyped(d.contracts.farm.address, purchase)))
    const conversion = { input: 10n, minimumFab: 9n, nonce: 0n, deadline: 1300n }
    expect(authorizationDigest(conversionTyped(d.projects[0].vault.address, conversion, 196))).not.toBe(authorizationDigest(conversionTyped(d.projects[0].vault.address, conversion)))
    expect(challengeMessage(config(), deployment, wallet.address, 'request', form, 1300)).toContain('Chain ID: 196\n')
  })
  it('rejects signed keeper transactions replayed onto the other chain', async () => {
    const plan = { type: 'legacy' as const, chainId: 196, to: d.contracts.farm.address, data: '0x1234' as const, value: 0n, nonce: 0, gas: 21000n, gasPrice: 1n }
    const raw = await keeperAccount.signTransaction(plan)
    expect(parseTransaction(raw).chainId).toBe(196)
    await expect(validateRaw(raw, plan, keeperAccount.address)).resolves.toBe(keccak256(raw))
    await expect(validateRaw(raw, { ...plan, chainId: 1952 }, keeperAccount.address)).rejects.toThrow('signed_transaction_mismatch')
  })
})
