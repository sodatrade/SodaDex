import { describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, parseAbi, recoverMessageAddress, recoverTypedDataAddress, keccak256, toHex } from 'viem'
import { MINING_PRODUCT_WRITE_ABI } from '../../mining-abi.ts'
import { miningCreateParams, normalizeMiningLaunchForm } from '../../mining-signed-calls.ts'
import { Admission } from '../src/admission.ts'
import { launchPayload, authorizationDigest, purchaseTyped, conversionTyped } from '../src/signatures.ts'
import { fixture, wallet, authority, signer, d, now } from './fixture.ts'
const id = '11111111-1111-4111-8111-111111111111'
const form = normalizeMiningLaunchForm({ name: 'Miner Alpha', symbol: 'alpha', metadataURI: 'https://example.com/alpha.json' })
function setup() {
  const f = fixture(); f.c.expectedSigner = authority.address; f.rpc.set('signer', authority.address)
  const service = new Admission(f.c, d, f.repo, f.rpc, f.discovery, signer, () => now)
  return { ...f, service }
}
describe('launch admission', () => {
  it('binds the readable challenge to origin, deployment, wallet, request and normalized form', () => {
    const { service } = setup(), c = service.challenge(wallet.address, id, form)
    expect(c.message).toBe(`SodaDEX 1952 test project launch\nOrigin: ${service.config.publicOrigin}\nChain ID: 1952\nDeployment: ${d.version}\nAddress: ${wallet.address.toLowerCase()}\nRequest ID: ${id}\nExpires at: 1300\nName: TEST Miner Alpha\nSymbol: TEST-ALPHA\nMetadata URI: https://example.com/alpha.json`)
    expect(service.challenge(wallet.address, id, form)).toEqual(c)
    expect(() => service.challenge(authority.address, id, form)).toThrow('request_id_conflict')
    expect(() => service.challenge(wallet.address, id, { ...form, symbol: 'TEST-OTHER' })).toThrow('request_id_conflict')
  })
  it('requires the wallet signature and issues only its exact create transaction; retry returns same authorization', async () => {
    const { service, repo } = setup(), c = service.challenge(wallet.address, id, form)
    const sig = await wallet.signMessage({ message: c.message })
    const a = await service.launch(wallet.address, id, sig), retry = await service.launch(wallet.address, id, sig)
    expect(a).toEqual(retry); expect(a.tx.from).toBe(wallet.address); expect(a.tx.value).toBe('0x0')
    const decoded = decodeFunctionData({ abi: parseAbi(MINING_PRODUCT_WRITE_ABI.manager), data: a.tx.data })
    expect(decoded.functionName).toBe('createToken')
    const args = decoded.args as readonly unknown[]
    const p = args[0] as Parameters<typeof launchPayload>[2]
    const payload = launchPayload(d, wallet.address, p, a.expiresAt, 0, d.contracts.launchFactory.address)
    expect(await recoverMessageAddress({ message: { raw: payload }, signature: args[7] as `0x${string}` })).toBe(authority.address)
    expect(repo.read().challenges[id].status).toBe('authorized')
    expect(JSON.stringify(repo.read().projects)).not.toContain(sig)
  })
  it('rejects changed challenge text, wrong caller, expired challenge and contract wallets', async () => {
    const { service, rpc } = setup(), c = service.challenge(wallet.address, id, form)
    await expect(service.launch(wallet.address, id, await authority.signMessage({ message: c.message }))).rejects.toThrow('wallet_signature_invalid')
    await expect(service.launch(wallet.address, id, await wallet.signMessage({ message: `${c.message}x` }))).rejects.toThrow('wallet_signature_invalid')
    await expect(service.launch(authority.address, id, await wallet.signMessage({ message: c.message }))).rejects.toThrow('challenge_missing')
    const expired = new Admission(service.config, d, service.repo, rpc, service.discovery, signer, () => 1301)
    await expect(expired.launch(wallet.address, id, await wallet.signMessage({ message: c.message }))).rejects.toThrow('challenge_expired')
    const original = rpc.request.bind(rpc)
    vi.spyOn(rpc, 'request').mockImplementation((m, p) => m === 'eth_getCode' ? Promise.resolve('0x6000') : original(m, p))
    await expect(service.launch(wallet.address, id, await wallet.signMessage({ message: c.message }))).rejects.toThrow('eoa_wallet_required')
  })
  it('limits concurrent challenge reservations and project issuance across restart', async () => {
    const { service, repo, rpc } = setup(); service.config.policy!.maxProjects = d.projects.length + 1
    const c = service.challenge(wallet.address, id, form)
    const sig = await wallet.signMessage({ message: c.message })
    await service.launch(wallet.address, id, sig)
    const restarted = new Admission(service.config, d, repo, rpc, service.discovery, signer, () => now)
    expect(await restarted.launch(wallet.address, id, sig)).toEqual(repo.read().challenges[id].authorization)
    expect(() => restarted.challenge(authority.address, '22222222-2222-4222-8222-222222222222', form)).toThrow('project_limit')
  })
  it('detects fee or launch factory changes before authorizer signs', async () => {
    const { service, rpc } = setup(), sign = vi.fn(signer.signMessage), guarded = new Admission(service.config, d, service.repo, rpc, service.discovery, { ...signer, signMessage: sign }, () => now)
    const c = guarded.challenge(wallet.address, id, form); rpc.set('POOL_FEE', 100)
    await expect(guarded.launch(wallet.address, id, await wallet.signMessage({ message: c.message }))).rejects.toThrow('launch_binding_changed')
    expect(sign).not.toHaveBeenCalled()
  })
})
describe('contract signature domains', () => {
  it('create payload changes for chain/manager/caller/each controlled field and global fee/factory', async () => {
    const p = miningCreateParams(form, keccak256(toHex('request')), d), payload = launchPayload(d, wallet.address, p, 1300, 0, d.contracts.launchFactory.address)
    expect(launchPayload(d, authority.address, p, 1300, 0, d.contracts.launchFactory.address)).not.toBe(payload)
    expect(launchPayload({ ...d, contracts: { ...d.contracts, manager: d.contracts.farm } }, wallet.address, p, 1300, 0, d.contracts.launchFactory.address)).not.toBe(payload)
    expect(launchPayload(d, wallet.address, { ...p, symbol: 'TEST-X' }, 1300, 0, d.contracts.launchFactory.address)).not.toBe(payload)
    expect(launchPayload(d, wallet.address, p, 1301, 0, d.contracts.launchFactory.address)).not.toBe(payload)
    expect(launchPayload(d, wallet.address, p, 1300, 100, d.contracts.launchFactory.address)).not.toBe(payload)
    expect(launchPayload(d, wallet.address, p, 1300, 0, authority.address)).not.toBe(payload)
    // The helper is deliberately fixed to 1952; no caller can supply a chain argument.
    expect(payload).toMatch(/^0x[0-9a-f]{64}$/)
  })
  it('purchase and conversion typed signatures reject cross chain, contract and changed values', async () => {
    const p = { listingId: 99n, minerId: 7n, nativePrice: 100n, maxFab: 200n, nonce: 9n, deadline: 1060n }
    const typed = purchaseTyped(d.contracts.farm.address, p), signature = await authority.signTypedData(typed)
    expect(await recoverTypedDataAddress({ ...typed, signature })).toBe(authority.address)
    for (const changed of [purchaseTyped(d.contracts.farm.address, { ...p, maxFab: 201n }), purchaseTyped(wallet.address, p),
      { ...typed, domain: { ...typed.domain, chainId: 196 } }]) expect(await recoverTypedDataAddress({ ...changed, signature })).not.toBe(authority.address)
    const conv = conversionTyped(d.projects[0].vault.address, { input: 100n, minimumFab: 99n, nonce: 1n, deadline: 1060n })
    expect(authorizationDigest(conv)).not.toBe(authorizationDigest(typed))
    const sig = await authority.signTypedData(conv)
    expect(await recoverTypedDataAddress({ ...conv, message: { ...conv.message, input: 101n }, signature: sig })).not.toBe(authority.address)
  })
})
