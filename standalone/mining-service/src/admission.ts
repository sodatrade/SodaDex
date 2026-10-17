import { encodeFunctionData, keccak256, parseAbi, recoverMessageAddress, toHex, type Address, type Hex } from 'viem'
import { MINING_PRODUCT_WRITE_ABI } from '../../mining-abi.ts'
import { miningCreateParams, miningLaunchVaultData, MINING_LAUNCH_TEST_POLICY, type MiningLaunchForm } from '../../mining-signed-calls.ts'
import type { MiningProductDeployment } from '../../mining-products.ts'
import { validMiningProductCall } from '../../mining-calls.ts'
import { Repository } from './repository.ts'
import { launchPayload } from './signatures.ts'
import { read, assertCanonical } from './rpc.ts'
import { ServiceError, same, type AdmissionSigner, type Challenge, type Discovery, type Rpc, type RuntimeConfig } from './types.ts'
export function challengeMessage(c: RuntimeConfig, d: MiningProductDeployment, address: Address, requestId: string, form: MiningLaunchForm, expiresAt: number): string {
  return `SodaDEX 1952 test project launch\nOrigin: ${c.publicOrigin}\nChain ID: 1952\nDeployment: ${d.version}\nAddress: ${address.toLowerCase()}\nRequest ID: ${requestId}\nExpires at: ${expiresAt}\nName: ${form.name}\nSymbol: ${form.symbol}\nMetadata URI: ${form.metadataURI}`
}
export class Admission {
  constructor(readonly config: RuntimeConfig, readonly d: MiningProductDeployment, readonly repo: Repository,
    readonly rpc: Rpc, readonly discovery: Discovery, readonly signer?: AdmissionSigner, readonly now = (): number => Math.floor(Date.now() / 1000)) {}
  private enabled(): void {
    if (!this.config.admissionEnabled || !this.config.policy || !this.signer || !same(this.signer.address, this.config.expectedSigner)) throw new ServiceError('admission_disabled', 503)
  }
  challenge(address: Address, requestId: string, form: MiningLaunchForm): Challenge {
    this.enabled()
    return this.repo.change(s => {
      const previous = s.challenges[requestId]
      if (previous) {
        if (!same(previous.address, address) || JSON.stringify(previous.form) !== JSON.stringify(form)) throw new ServiceError('request_id_conflict')
        if (previous.expiresAt < this.now()) throw new ServiceError('challenge_expired')
        return previous
      }
      for (const [id, c] of Object.entries(s.challenges)) if (c.status === 'issued' && c.expiresAt < this.now()) delete s.challenges[id]
      const p = this.config.policy!
      const reserved = Object.values(s.challenges).filter(c => c.status !== 'issued' && c.status !== 'registered')
      if (Object.keys(s.projects).length + reserved.length >= p.maxProjects ||
          Object.values(s.challenges).filter(c => c.status !== 'issued' && same(c.address, address)).length >= p.maxProjectsPerWallet) throw new ServiceError('project_limit')
      if (Object.values(s.challenges).some(c => c.status === 'issued' && same(c.address, address)) ||
          Object.values(s.challenges).filter(c => c.status === 'issued').length >= p.maxProjects * 2) throw new ServiceError('challenge_pending')
      const expiresAt = this.now() + 300
      const value: Challenge = { address, requestId, form, expiresAt, status: 'issued', createdAt: this.now(),
        message: challengeMessage(this.config, this.d, address, requestId, form, expiresAt) }
      s.challenges[requestId] = value; return value
    })
  }
  async launch(address: Address, requestId: string, signature: Hex): Promise<NonNullable<Challenge['authorization']>> {
    this.enabled()
    let c = this.repo.read().challenges[requestId]
    if (!c || !same(c.address, address)) throw new ServiceError('challenge_missing', 404)
    if (c.expiresAt < this.now()) throw new ServiceError('challenge_expired')
    let recovered: Address
    try { recovered = await recoverMessageAddress({ message: c.message, signature }) } catch { throw new ServiceError('wallet_signature_invalid', 401) }
    if (!same(recovered, address)) throw new ServiceError('wallet_signature_invalid', 401)
    if (c.authorization) {
      if (c.authorization.expiresAt < this.now()) throw new ServiceError('authorization_expired')
      return c.authorization
    }
    const b = await this.discovery.verifyBase(this.rpc, this.d, this.config.expectedSigner)
    const code = await this.rpc.request('eth_getCode', [address, b.number])
    if (code !== '0x') throw new ServiceError('eoa_wallet_required', 422)
    this.repo.change(s => {
      const current = s.challenges[requestId]
      if (!current || current.expiresAt < this.now() || current.status === 'registered') throw new ServiceError('challenge_expired')
      if (current.status === 'issued') {
        const p = this.config.policy!, reserved = Object.values(s.challenges).filter(x => x.status !== 'issued' && x.status !== 'registered')
        if (Object.keys(s.projects).length + reserved.length >= p.maxProjects ||
            Object.values(s.challenges).filter(x => x.status !== 'issued' && same(x.address, address)).length >= p.maxProjectsPerWallet) throw new ServiceError('project_limit')
        current.status = 'verified'
      }
      c = current
    })
    await this.repo.flush()
    const manager = this.d.contracts.manager.address
    const [poolFee, factory, signer] = await Promise.all([
      read<number>(this.rpc, manager, 'function POOL_FEE() view returns(uint24)', [], b.number),
      read<Address>(this.rpc, manager, 'function LAUNCH_FACTORY() view returns(address)', [], b.number),
      read<Address>(this.rpc, manager, 'function signer() view returns(address)', [], b.number),
    ])
    if (poolFee !== 0 || !same(factory, this.d.contracts.launchFactory.address) || !same(signer, this.config.expectedSigner)) throw new ServiceError('launch_binding_changed', 503)
    // Deterministic per deployment + verified wallet request; retries never create another salt.
    const salt = keccak256(toHex(`${this.d.version}:${address.toLowerCase()}:${requestId}`))
    const p = miningCreateParams(c.form, salt, this.d), expiresAt = Math.min(c.expiresAt, Number(b.timestamp) + 300)
    if (expiresAt <= this.now() + 15) throw new ServiceError('challenge_expiring')
    const sig = await this.signer!.signMessage(launchPayload(this.d, address, p, expiresAt, poolFee, factory))
    const args = [p, this.d.templateId, miningLaunchVaultData(), BigInt(expiresAt), this.d.contracts.miningFactory.address,
      MINING_LAUNCH_TEST_POLICY.venue, MINING_LAUNCH_TEST_POLICY.graduationProtectionSecs, sig] as const
    const tx = { from: address, to: manager, value: '0x0' as Hex,
      data: encodeFunctionData({ abi: parseAbi(MINING_PRODUCT_WRITE_ABI.manager), functionName: 'createToken', args }) }
    if (!validMiningProductCall(tx, this.d, true, this.now())) throw new ServiceError('launch_policy_invalid', 503)
    await this.rpc.request('eth_call', [tx, b.number])
    await assertCanonical(this.rpc, b)
    const authorization = { requestId, form: c.form, expiresAt, tx }
    this.repo.change(s => { s.challenges[requestId].authorization = authorization; s.challenges[requestId].status = 'authorized' })
    await this.repo.flush()
    return authorization
  }
}
