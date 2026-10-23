import { describe, expect, it, vi } from 'vitest'
import { keccak256, toHex, type Address } from 'viem'
import { verifyDeployment, type FragmentClient } from '../src/fragments/client'
import { parseDeployment, type FragmentDeployment } from '../src/fragments/config'
import { NETWORK } from '../src/network'
const address = (n: number): Address => `0x${String(n).repeat(40)}`
const d: FragmentDeployment = { chainId: 196, pool: address(1), vault: address(2), policy: address(3), income: address(4), ignixTreasury: address(5), fromBlock: 1n, rpcUrl: '/api/fragments/rpc' }
function client(version = 'v4', overrides: Record<string, Address> = {}): FragmentClient {
  return { getChainId: vi.fn().mockResolvedValue(196), readContract: vi.fn(async ({ address: target, functionName }: { address: Address; functionName: string }) => {
    const product = version === 'mirror' ? 'SodaDEX.OKB.MirrorEpochPool.v1' : `SodaDEX.OKB.Fragments.${version}`
    const values: Record<string, string> = { PRODUCT_VERSION: keccak256(toHex(product)), VAULT: d.vault, POLICY: d.policy, REWARDS: address(6), INCOME: d.income!, FAB: address(7), POOL: d.pool, RECIPIENT: d.ignixTreasury!,
      LP_POOL: d.pool, LP_REWARDS_VERSION: keccak256(toHex('SodaDEX.MirrorEpochRewards.v1')) }
    return overrides[`${target}:${functionName}`] ?? values[functionName]
  }) } as unknown as FragmentClient
}
describe('special pool IGNIX income binding', () => {
  it('accepts legacy pools without income and the new revision with every binding verified', async () => {
    await expect(verifyDeployment(client('v3'), { ...d, income: undefined, ignixTreasury: undefined })).resolves.toMatchObject({ preciseLiquidity: true })
    await expect(verifyDeployment(client(), d)).resolves.toMatchObject({ preciseLiquidity: true })
  })
  it('rejects missing manifest, wrong recipient, asset, pool and accounting contract', async () => {
    await expect(verifyDeployment(client(), { ...d, income: undefined })).rejects.toThrow()
    await expect(verifyDeployment(client('v3'), d)).rejects.toThrow()
    for (const key of [`${d.pool}:INCOME`, `${d.income}:POOL`, `${d.income}:FAB`, `${d.income}:RECIPIENT`])
      await expect(verifyDeployment(client('v4', { [key]: address(9) }), d)).rejects.toThrow()
  })
  it('accepts the MirrorVault epoch pool only with the vault bound back to it', async () => {
    await expect(verifyDeployment(client('mirror'), d)).resolves.toMatchObject({ preciseLiquidity: true, mirrorVault: true })
    await expect(verifyDeployment(client('v4'), d)).resolves.toMatchObject({ mirrorVault: false })
    for (const key of [`${d.vault}:LP_POOL`, `${d.vault}:LP_REWARDS_VERSION`, `${d.vault}:POLICY`])
      await expect(verifyDeployment(client('mirror', { [key]: address(9) }), d)).rejects.toThrow()
    await expect(verifyDeployment(client('mirror'), { ...d, income: undefined, ignixTreasury: undefined })).rejects.toThrow()
  })
  it('requires both income and treasury in a public manifest', () => {
    const manifest = { chainId: NETWORK.chainId, pool: d.pool, vault: d.vault, policy: d.policy, fromBlock: '1', income: d.income }
    expect(() => parseDeployment(JSON.stringify(manifest))).toThrow()
    expect(parseDeployment(JSON.stringify({ ...manifest, ignixTreasury: d.ignixTreasury }))).toMatchObject({ income: d.income })
  })
})
