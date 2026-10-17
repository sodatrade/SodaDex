import { encodeFunctionData, parseAbi, type Abi, type Address, type Hex } from 'viem'
import { MINING_PRODUCT_WRITE_ABI, MINING_PURCHASE_PARAMS_ABI, MINING_CONVERSION_PARAMS_ABI } from '../../mining-abi.ts'
import type { MiningProductDeployment, MiningProject } from '../../mining-products.ts'
import type { MiningConversion, MiningPurchase } from '../../mining-signed-calls.ts'
import { Repository } from './repository.ts'
import { read, assertCanonical } from './rpc.ts'
import { authorizationDigest, conversionTyped, purchaseTyped } from './signatures.ts'
import { same, ServiceError, type AdmissionSigner, type Block, type Discovery, type JobKind, type PreparedCall, type Rpc, type RuntimeConfig } from './types.ts'
const ceiling = (v: bigint, bps: number): bigint => (v * BigInt(10000 + bps) + 9999n) / 10000n
const call = (to: Address, role: 'farm' | 'projectVault', name: string, args: readonly unknown[], kind: JobKind, jobId: string, token?: Address): PreparedCall =>
  ({ to, data: encodeFunctionData({ abi: parseAbi(MINING_PRODUCT_WRITE_ABI[role]) as Abi, functionName: name, args }), kind, jobId, ...(token ? { token } : {}) })
export class Planner {
  constructor(readonly c: RuntimeConfig, readonly d: MiningProductDeployment, readonly repo: Repository, readonly rpc: Rpc,
    readonly discovery: Discovery, readonly signer?: AdmissionSigner, readonly now = (): number => Math.floor(Date.now() / 1000)) {}
  private waiting(id: string, kind: JobKind, reason: string, token?: Address): undefined {
    this.repo.change(s => { s.jobs[id] = { id, kind, status: 'waiting', reason, ...(token ? { token } : {}), updatedAt: this.now() * 1000 } })
    return undefined
  }
  private nonce(scope: string): bigint {
    const prior = this.repo.read().authorizations[scope]
    if (prior && prior.expiresAt >= this.now()) throw new ServiceError('authorization_pending')
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const nonce = BigInt(`0x${Array.from(bytes, v => v.toString(16).padStart(2, '0')).join('')}`)
    this.repo.change(s => { s.authorizations[scope] = { nonce: String(nonce), expiresAt: this.now() + 60 } })
    return nonce
  }
  async next(): Promise<PreparedCall | undefined> {
    if (!this.c.policy || !this.signer || !same(this.signer.address, this.c.expectedSigner)) throw new ServiceError('execution_policy_pending', 503)
    const b = await this.discovery.verifyBase(this.rpc, this.d, this.c.expectedSigner)
    const projects = Object.values(this.repo.read().projects)
    const options: (MiningProject | undefined)[] = [...projects, undefined]
    const start = this.repo.read().cursor % options.length
    for (let n = 0; n < options.length; n++) {
      const index = (start + n) % options.length
      const p = options[index], result = p ? await this.project(p, b) : await this.purchase(b)
      this.repo.change(s => { s.cursor = (index + 1) % options.length })
      if (result) { await assertCanonical(this.rpc, b); await this.repo.flush(); return { ...result, verifiedBlock: b } }
    }
    await assertCanonical(this.rpc, b); await this.repo.flush(); return undefined
  }
  private async project(saved: MiningProject, b: Block): Promise<PreparedCall | undefined> {
    const p = await this.discovery.resolveProject(this.rpc, this.d, saved.token.address, this.c.expectedSigner, b)
    this.repo.change(s => { if (JSON.stringify(s.projects[p.token.address.toLowerCase()]) !== JSON.stringify(p)) { s.projects[p.token.address.toLowerCase()] = p; s.revision++ } })
    const vault = p.vault.address, token = p.token.address, farm = this.d.contracts.farm.address
    const id = `project:${token.toLowerCase()}`
    const [fab, reserved, fund] = await Promise.all([
      read<bigint>(this.rpc, this.d.contracts.fab.address, 'function balanceOf(address) view returns(uint256)', [vault], b.number),
      read<bigint>(this.rpc, vault, 'function reserved() view returns(uint256)', [], b.number),
      read<bigint>(this.rpc, vault, 'function farmPending() view returns(uint256)', [], b.number),
    ])
    if (fab > reserved) return call(vault, 'projectVault', 'sync', [], 'sync', id, token)
    if (fund > 0n) {
      const [cursor, batches] = await Promise.all([
        read<bigint>(this.rpc, farm, 'function vaultBatchCursor(address) view returns(uint256)', [vault], b.number),
        read<bigint>(this.rpc, farm, 'function incomeBatchCount() view returns(uint256)', [], b.number),
      ])
      if (cursor < batches) return call(farm, 'farm', 'syncVault', [vault], 'sync', id, token)
      return call(vault, 'projectVault', 'fundFarm', [], 'fund', id, token)
    }
    if (!p.pair) return this.waiting(id, 'conversion', 'not_graduated', token)
    const balance = await read<bigint>(this.rpc, token, 'function balanceOf(address) view returns(uint256)', [vault], b.number)
    if (balance === 0n) return this.waiting(id, 'conversion', 'no_tax', token)
    const input = balance < this.c.policy!.maxConversionInputRaw ? balance : this.c.policy!.maxConversionInputRaw
    const exempt = await read<boolean>(this.rpc, token, 'function taxExempt(address) view returns(bool)', [vault], b.number)
    const taxBps = await read<number>(this.rpc, token, 'function taxSellBps() view returns(uint16)', [], b.number)
    if (taxBps !== 100) throw new ServiceError('token_tax_policy_changed', 503)
    const effective = exempt ? input : input - input * BigInt(taxBps) / 10000n
    if (effective <= 0n) return this.waiting(id, 'conversion', 'tax_dust', token)
    const quote = await read<readonly bigint[]>(this.rpc, this.d.contracts.router.address,
      'function getAmountsOut(uint256,address[]) view returns(uint256[])', [effective, [token, this.d.contracts.fab.address]], b.number)
    const minimumFab = quote[1] * BigInt(10000 - this.c.policy!.slippageBps) / 10000n
    if (quote.length !== 2 || quote[0] !== effective || minimumFab <= 0n) return this.waiting(id, 'conversion', 'quote_too_small', token)
    const nonce = this.nonce(`conversion:${vault.toLowerCase()}`)
    const params: MiningConversion = { input, minimumFab, nonce, deadline: b.timestamp + 60n }
    if (await read<boolean>(this.rpc, vault, 'function usedConversionNonce(uint256) view returns(bool)', [nonce], b.number)) throw new ServiceError('authorization_nonce_used')
    const typed = conversionTyped(vault, params)
    const digest = await read<Hex>(this.rpc, vault, `function conversionDigest(${MINING_CONVERSION_PARAMS_ABI} p) view returns(bytes32)`, [params], b.number)
    if (digest !== authorizationDigest(typed)) throw new ServiceError('conversion_digest_mismatch', 503)
    await this.repo.flush()
    const signature = await this.signer!.signTypedData(typed)
    return { ...call(vault, 'projectVault', 'convertTax', [params, signature], 'conversion', id, token), deadline: Number(params.deadline) }
  }
  private async purchase(b: Block): Promise<PreparedCall | undefined> {
    const d = this.d.contracts, farm = d.farm.address, p = this.c.policy!, id = 'farm:purchase'
    const [count, cap, budget, paused, spent] = await Promise.all([
      read<bigint>(this.rpc, farm, 'function minerCount() view returns(uint256)', [], b.number),
      read<number>(this.rpc, farm, 'function MAX_MINERS() view returns(uint16)', [], b.number),
      read<bigint>(this.rpc, farm, 'function procurementBudget() view returns(uint256)', [], b.number),
      read<boolean>(this.rpc, farm, 'function sourcePaused() view returns(bool)', [], b.number),
      read<bigint>(this.rpc, farm, 'function procurementSpent() view returns(uint256)', [], b.number),
    ])
    this.repo.change(s => { s.farm = { capacity: cap, minerCount: Number(count), procurementBudgetFab: String(budget) } })
    if (count >= BigInt(cap)) return this.waiting(id, 'purchase', 'farm_full')
    if (paused) return this.waiting(id, 'purchase', 'source_paused')
    if (budget === 0n || spent >= p.maxProcurementFabRaw) return this.waiting(id, 'purchase', 'procurement_budget_exhausted')
    for (const listing of p.allowedListingIds) {
      if (this.d.testListingIds?.includes(listing)) continue // Reserved for individual frontend purchases.
      const view = await read<readonly [Address, Address, bigint, bigint, number, boolean]>(this.rpc, d.circuitMarket.address,
        'function listingView(uint256) view returns(address,address,uint256,uint96,uint16,bool)', [BigInt(listing)], b.number)
      const [seller, collection, minerId, nativePrice, , valid] = view
      if (!valid || !same(seller, p.inventorySeller) || !same(collection, d.circuits.address) || nativePrice <= 0n || nativePrice > p.maxMinerPriceWei) continue
      if (!same(await read<Address>(this.rpc, collection, 'function ownerOf(uint256) view returns(address)', [minerId], b.number), seller) ||
          !await read<boolean>(this.rpc, farm, 'function admissibleMiner(uint256) view returns(bool)', [minerId], b.number)) continue
      const approved = await read<Address>(this.rpc, collection, 'function getApproved(uint256) view returns(address)', [minerId], b.number)
      if (!same(approved, d.circuitMarket.address) && !await read<boolean>(this.rpc, collection,
        'function isApprovedForAll(address,address) view returns(bool)', [seller, d.circuitMarket.address], b.number)) continue
      const quote = await read<readonly bigint[]>(this.rpc, d.router.address,
        'function getAmountsIn(uint256,address[]) view returns(uint256[])', [nativePrice, [d.fab.address, d.wrappedNative.address]], b.number)
      if (quote.length !== 2 || quote[0] <= 0n || quote[1] !== nativePrice) throw new ServiceError('procurement_quote_invalid', 503)
      const maxFab = ceiling(quote[0], p.slippageBps)
      if (maxFab > budget || spent + maxFab > p.maxProcurementFabRaw) continue
      const nonce = this.nonce(`purchase:${farm.toLowerCase()}`)
      const params: MiningPurchase = { listingId: BigInt(listing), minerId, nativePrice, maxFab, nonce, deadline: b.timestamp + 60n }
      if (await read<boolean>(this.rpc, farm, 'function usedNonce(uint256) view returns(bool)', [nonce], b.number)) throw new ServiceError('authorization_nonce_used')
      const typed = purchaseTyped(farm, params)
      const digest = await read<Hex>(this.rpc, farm, `function purchaseDigest(${MINING_PURCHASE_PARAMS_ABI} p) view returns(bytes32)`, [params], b.number)
      if (digest !== authorizationDigest(typed)) throw new ServiceError('purchase_digest_mismatch', 503)
      await this.repo.flush()
      const signature = await this.signer!.signTypedData(typed)
      return { ...call(farm, 'farm', 'buyMiner', [params, signature], 'purchase', id), deadline: Number(params.deadline) }
    }
    return this.waiting(id, 'purchase', 'no_approved_inventory')
  }
}
