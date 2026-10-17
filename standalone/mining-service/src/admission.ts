import { decodeEventLog, encodeFunctionData, keccak256, parseAbi, recoverMessageAddress, toHex, type Address, type Hex } from 'viem'
import { MINING_PRODUCT_WRITE_ABI } from '../../mining-abi.ts'
import { miningCreateParams, miningLaunchVaultData, MINING_LAUNCH_TEST_POLICY, type MiningLaunchForm } from '../../mining-signed-calls.ts'
import type { MiningProductDeployment } from '../../mining-products.ts'
import { validMiningProductCall } from '../../mining-calls.ts'
import { Repository } from './repository.ts'
import { launchPayload } from './signatures.ts'
import { read, assertCanonical, block } from './rpc.ts'
import { ServiceError, same, hash, record, quantity, type AdmissionSigner, type Block, type Challenge, type Discovery, type Rpc, type RuntimeConfig } from './types.ts'
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
        if (previous.status === 'expired' || previous.expiresAt < this.now()) throw new ServiceError('challenge_expired')
        return previous
      }
      for (const [id, c] of Object.entries(s.challenges)) if (c.status === 'issued' && c.expiresAt < this.now()) delete s.challenges[id]
      const p = this.config.policy!
      const reserved = Object.values(s.challenges).filter(c => c.status !== 'issued' && c.status !== 'registered' && c.status !== 'expired')
      if (Object.keys(s.projects).length + reserved.length >= p.maxProjects ||
          Object.values(s.challenges).filter(c => c.status !== 'issued' && c.status !== 'expired' && same(c.address, address)).length >= p.maxProjectsPerWallet) throw new ServiceError('project_limit')
      // Unverified requests are replaceable cache entries, never wallet/project locks.
      // Only a valid personal signature below can claim non-evictable admission quota.
      const issued = Object.values(s.challenges).filter(c => c.status === 'issued').toSorted((a, b) => a.createdAt - b.createdAt)
      while (issued.length >= p.maxProjects * 2) {
        const oldest = issued.shift()!
        delete s.challenges[oldest.requestId]
      }
      const expiresAt = this.now() + 300
      const value: Challenge = { address, requestId, form, expiresAt, status: 'issued', createdAt: this.now(),
        message: challengeMessage(this.config, this.d, address, requestId, form, expiresAt) }
      s.challenges[requestId] = value; return value
    })
  }
  /** Release only chain-proven expired, uncreated slots. Tombstones keep IDs one-use. */
  async reconcileExpired(verified?: Block): Promise<void> {
    const candidates = Object.values(this.repo.read().challenges).filter(c =>
      c.status === 'expired' || ['verified', 'authorized'].includes(c.status) && c.expiresAt < this.now())
    if (candidates.length === 0) return
    const b = verified ?? await this.discovery.verifyBase(this.rpc, this.d, this.config.expectedSigner)
    const changes: { c: Challenge; project?: Awaited<ReturnType<Discovery['resolveProject']>> }[] = []
    const factoryEvents = parseAbi(['event TokenDeployed(address indexed token,address indexed manager,bytes32 salt)'])
    for (const saved of candidates) {
      const c = structuredClone(saved)
      if (c.status === 'expired') {
        if (!c.expiryProof) throw new ServiceError('expiry_proof_missing', 503)
        const canonical = BigInt(c.expiryProof.number) <= BigInt(b.number) && same((await block(this.rpc, c.expiryProof.number)).hash, c.expiryProof.hash)
        if (canonical) continue
        c.status = c.expiryProof.previousStatus; delete c.expiryProof
      }
      const expiresAt = c.authorization?.expiresAt ?? c.expiresAt
      if (b.timestamp <= BigInt(expiresAt)) { changes.push({ c }); continue }
      if (!c.verifiedAtBlock) throw new ServiceError('expiry_proof_missing', 503)
      let created: Address | undefined
      if (c.authorization) {
        const salt = keccak256(toHex(`${this.d.version}:${c.address.toLowerCase()}:${c.requestId}`))
        const logs = await this.rpc.request('eth_getLogs', [{ address: this.d.contracts.launchFactory.address,
          fromBlock: c.verifiedAtBlock, toBlock: b.number, topics: [keccak256(toHex('TokenDeployed(address,address,bytes32)')), null,
            `0x${this.d.contracts.manager.address.slice(2).toLowerCase().padStart(64, '0')}`] }])
        if (!Array.isArray(logs)) throw new ServiceError('expiry_proof_unavailable', 503)
        for (const log of logs) {
          if (!record(log) || typeof log.address !== 'string' || !same(log.address, this.d.contracts.launchFactory.address) ||
              typeof log.data !== 'string' || !Array.isArray(log.topics) || !hash(log.blockHash) || log.removed === true ||
              quantity(log.blockNumber) < BigInt(c.verifiedAtBlock) || quantity(log.blockNumber) > BigInt(b.number)) throw new ServiceError('expiry_proof_unavailable', 503)
          const event = decodeEventLog({ abi: factoryEvents, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]], strict: true })
          if (!same(event.args.manager, this.d.contracts.manager.address)) throw new ServiceError('expiry_proof_unavailable', 503)
          if (event.args.salt === salt) {
            if (created) throw new ServiceError('expiry_proof_unavailable', 503)
            if (!same((await block(this.rpc, String(log.blockNumber))).hash, log.blockHash)) throw new ServiceError('chain_reorg', 503)
            created = event.args.token
          }
        }
      }
      if (created) {
        const project = await this.discovery.resolveProject(this.rpc, this.d, created, this.config.expectedSigner, b)
        if (project.symbol !== c.form.symbol) throw new ServiceError('expiry_project_mismatch', 503)
        c.status = 'registered'; changes.push({ c, project })
      } else {
        c.expiryProof = { number: b.number, hash: b.hash, previousStatus: c.status as 'verified' | 'authorized' }
        c.status = 'expired'; changes.push({ c })
      }
    }
    await assertCanonical(this.rpc, b)
    this.repo.change(s => {
      for (const { c, project } of changes) {
        s.challenges[c.requestId] = c
        if (project && JSON.stringify(s.projects[project.token.address.toLowerCase()]) !== JSON.stringify(project)) {
          s.projects[project.token.address.toLowerCase()] = project; s.revision++
        }
      }
    })
    await this.repo.flush()
  }
  async launch(address: Address, requestId: string, signature: Hex): Promise<NonNullable<Challenge['authorization']>> {
    this.enabled()
    let c = this.repo.read().challenges[requestId]
    if (!c || !same(c.address, address)) throw new ServiceError('challenge_missing', 404)
    if (c.status === 'expired' || c.expiresAt < this.now()) throw new ServiceError('challenge_expired')
    let recovered: Address
    try { recovered = await recoverMessageAddress({ message: c.message, signature }) } catch { throw new ServiceError('wallet_signature_invalid', 401) }
    if (!same(recovered, address)) throw new ServiceError('wallet_signature_invalid', 401)
    if (c.authorization) {
      if (c.authorization.expiresAt < this.now()) throw new ServiceError('authorization_expired')
      return c.authorization
    }
    const b = await this.discovery.verifyBase(this.rpc, this.d, this.config.expectedSigner)
    await this.reconcileExpired(b)
    const code = await this.rpc.request('eth_getCode', [address, b.number])
    if (code !== '0x') throw new ServiceError('eoa_wallet_required', 422)
    this.repo.change(s => {
      const current = s.challenges[requestId]
      if (!current || current.expiresAt < this.now() || ['registered', 'expired'].includes(current.status)) throw new ServiceError('challenge_expired')
      if (current.status === 'issued') {
        const p = this.config.policy!, reserved = Object.values(s.challenges).filter(x => x.status !== 'issued' && x.status !== 'registered' && x.status !== 'expired')
        if (Object.keys(s.projects).length + reserved.length >= p.maxProjects ||
            Object.values(s.challenges).filter(x => x.status !== 'issued' && x.status !== 'expired' && same(x.address, address)).length >= p.maxProjectsPerWallet) throw new ServiceError('project_limit')
        current.status = 'verified'; current.verifiedAtBlock = b.number
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
