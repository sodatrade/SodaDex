import { decodeFunctionData, encodeFunctionData, parseAbi, recoverTransactionAddress, parseTransaction, recoverTypedDataAddress, keccak256, type Address, type Hex, type TransactionSerialized, type TransactionSerializableLegacy } from 'viem'
import { MINING_PRODUCT_WRITE_ABI } from '../../mining-abi.ts'
import type { MiningProductDeployment, MiningProject } from '../../mining-products.ts'
import type { MiningPurchase, MiningConversion } from '../../mining-signed-calls.ts'
import { read, assertCanonical } from './rpc.ts'
import { purchaseTyped, conversionTyped } from './signatures.ts'
import { same, ServiceError, type Block, type Discovery, type Rpc, type RuntimeConfig, type Execution, type PreparedCall } from './types.ts'
/** Keeper accepts only these four exact product operations. It has no arbitrary call endpoint. */
export function validKeeperCall(call: PreparedCall, d: MiningProductDeployment, projects: readonly MiningProject[]): boolean {
  let role: 'farm' | 'projectVault'
  if (same(call.to, d.contracts.farm.address)) role = 'farm'
  else if (projects.some(p => same(p.vault.address, call.to))) role = 'projectVault'
  else return false
  try {
    const abi = parseAbi(MINING_PRODUCT_WRITE_ABI[role]), decoded = decodeFunctionData({ abi, data: call.data })
    if (encodeFunctionData({ abi, functionName: decoded.functionName, args: decoded.args }) !== call.data) return false
    const args = decoded.args ?? []
    if (role === 'farm') return decoded.functionName === 'buyMiner' && call.kind === 'purchase' ||
      decoded.functionName === 'syncVault' && call.kind === 'sync' && projects.some(p => same(p.vault.address, String(args[0])))
    return decoded.functionName === 'sync' && call.kind === 'sync' || decoded.functionName === 'fundFarm' && call.kind === 'fund' ||
      decoded.functionName === 'convertTax' && call.kind === 'conversion'
  } catch { return false }
}
export async function validateRaw(raw: Hex, plan: TransactionSerializableLegacy, signer: string): Promise<Hex> {
  const tx = parseTransaction(raw)
  const from = await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })
  if (!same(from, signer) || tx.chainId !== plan.chainId || ![1952, 196].includes(plan.chainId ?? 0) || tx.type !== 'legacy' || !same(tx.to ?? '', plan.to ?? '') ||
      (tx.value ?? 0n) !== 0n || tx.data !== plan.data || tx.gas !== plan.gas || tx.gasPrice !== plan.gasPrice || tx.nonce !== plan.nonce) throw new ServiceError('signed_transaction_mismatch', 503)
  return keccak256(raw)
}
export async function validateSaved(e: Execution, d: MiningProductDeployment, projects: readonly MiningProject[]): Promise<void> {
  const tx = parseTransaction(e.raw)
  if (tx.gas === undefined || tx.gasPrice === undefined || tx.gas * tx.gasPrice !== BigInt(e.maxCostWei) ||
      tx.gas !== BigInt(e.gas) || tx.gasPrice !== BigInt(e.gasPrice)) throw new ServiceError('stored_transaction_invalid', 503)
  const job: PreparedCall = { to: e.to, data: e.data, kind: e.jobId === 'farm:purchase' ? 'purchase' : (() => {
    for (const role of ['farm', 'projectVault'] as const) {
      try { const name = decodeFunctionData({ abi: parseAbi(MINING_PRODUCT_WRITE_ABI[role]), data: e.data }).functionName
        if (name === 'sync' || name === 'syncVault') return 'sync'
        if (name === 'fundFarm') return 'fund'
        if (name === 'convertTax') return 'conversion'
      } catch { /* Try the other fixed role ABI. */ }
    }
    throw new ServiceError('stored_transaction_invalid', 503)
  })(), jobId: e.jobId }
  if (!validKeeperCall(job, d, projects) || await validateRaw(e.raw, {
    chainId: d.chainId, to: e.to, data: e.data, value: 0n, nonce: e.nonce, gas: BigInt(e.gas), gasPrice: BigInt(e.gasPrice), type: 'legacy',
  }, e.signer) !== e.hash) throw new ServiceError('stored_transaction_invalid', 503)
}

/** Live authorization is required immediately before any broadcast, including recovery. */
export async function assertLiveExecution(e: Pick<Execution, 'signer' | 'to' | 'data' | 'gas' | 'gasPrice'>, c: RuntimeConfig, d: MiningProductDeployment, rpc: Rpc, discovery: Discovery, projects: readonly MiningProject[], initialProof?: Block): Promise<void> {
  if (!c.executionEnabled || !c.policy || !c.keeperAddress || !same(c.keeperAddress, e.signer) ||
      BigInt(e.gas) > c.maxGasPerTransaction || BigInt(e.gasPrice) > c.maxGasPriceWei) throw new ServiceError('execution_policy_changed')
  const b = initialProof ?? await discovery.verifyBase(rpc, d, c.expectedSigner)
  if (!initialProof) await assertCanonical(rpc, b)
  const project = projects.find(p => same(p.vault.address, e.to))
  const farm = d.contracts.farm.address
  const role = same(e.to, farm) ? 'farm' : project ? 'projectVault' : undefined
  if (!role) throw new ServiceError('keeper_call_rejected', 503)
  const decoded = decodeFunctionData({ abi: parseAbi(MINING_PRODUCT_WRITE_ABI[role]), data: e.data })
  const args = decoded.args ?? []
  const verifiedProject = project ? initialProof ? project : await discovery.resolveProject(rpc, d, project.token.address, c.expectedSigner, b) : undefined
  if (decoded.functionName === 'syncVault') {
    const target = projects.find(p => same(p.vault.address, String(args[0])))
    if (!target) throw new ServiceError('project_not_registered')
    if (!initialProof) await discovery.resolveProject(rpc, d, target.token.address, c.expectedSigner, b)
  }
  if (decoded.functionName === 'buyMiner') {
    const p = args[0] as MiningPurchase, policy = c.policy
    if (!policy.allowedListingIds.includes(String(p.listingId)) || d.testListingIds?.includes(String(p.listingId)) ||
        p.nativePrice <= 0n || p.nativePrice > policy.maxMinerPriceWei || p.maxFab <= 0n ||
        p.deadline < b.timestamp || p.deadline > b.timestamp + 60n) throw new ServiceError('purchase_policy_changed')
    if (!same(await recoverTypedDataAddress({ ...purchaseTyped(farm, p, d.chainId), signature: args[1] as Hex }), c.expectedSigner)) throw new ServiceError('purchase_state_changed')
    // Planner checked these exact historical-state reads at b in this event.
    // Its proof is never stored with Execution or reconstructed after restart.
    if (initialProof) { await assertCanonical(rpc, b); return }
    const [listing, count, cap, budget, spent, paused, used] = await Promise.all([
      read<readonly [Address, Address, bigint, bigint, number, boolean]>(rpc, d.contracts.circuitMarket.address,
        'function listingView(uint256) view returns(address,address,uint256,uint96,uint16,bool)', [p.listingId], b.number),
      read<bigint>(rpc, farm, 'function minerCount() view returns(uint256)', [], b.number),
      read<number>(rpc, farm, 'function MAX_MINERS() view returns(uint16)', [], b.number),
      read<bigint>(rpc, farm, 'function procurementBudget() view returns(uint256)', [], b.number),
      read<bigint>(rpc, farm, 'function procurementSpent() view returns(uint256)', [], b.number),
      read<boolean>(rpc, farm, 'function sourcePaused() view returns(bool)', [], b.number),
      read<boolean>(rpc, farm, 'function usedNonce(uint256) view returns(bool)', [p.nonce], b.number),
    ])
    const [seller, collection, minerId, nativePrice, , valid] = listing
    if (!valid || used || paused || !same(seller, policy.inventorySeller) || !same(collection, d.contracts.circuits.address) ||
        minerId !== p.minerId || nativePrice !== p.nativePrice || count >= BigInt(cap) || p.maxFab > budget || spent + p.maxFab > policy.maxProcurementFabRaw) throw new ServiceError('purchase_state_changed')
    const [owner, approved, all, admissible, quote] = await Promise.all([
      read<Address>(rpc, collection, 'function ownerOf(uint256) view returns(address)', [minerId], b.number),
      read<Address>(rpc, collection, 'function getApproved(uint256) view returns(address)', [minerId], b.number),
      read<boolean>(rpc, collection, 'function isApprovedForAll(address,address) view returns(bool)', [seller, d.contracts.circuitMarket.address], b.number),
      read<boolean>(rpc, farm, 'function admissibleMiner(uint256) view returns(bool)', [minerId], b.number),
      read<readonly bigint[]>(rpc, d.contracts.router.address, 'function getAmountsIn(uint256,address[]) view returns(uint256[])',
        [nativePrice, [d.contracts.fab.address, d.contracts.wrappedNative.address]], b.number),
    ])
    if (!same(owner, seller) || !admissible || !same(approved, d.contracts.circuitMarket.address) && !all || quote.length !== 2 ||
        quote[0] <= 0n || quote[1] !== nativePrice || quote[0] > p.maxFab || p.maxFab > (quote[0] * BigInt(10000 + policy.slippageBps) + 9999n) / 10000n) throw new ServiceError('purchase_state_changed')
  }
  if (decoded.functionName === 'convertTax') {
    if (!project) throw new ServiceError('project_not_registered')
    const verified = verifiedProject!
    const p = args[0] as MiningConversion
    if (!verified.pair || p.input <= 0n || p.input > c.policy.maxConversionInputRaw || p.minimumFab <= 0n ||
        p.deadline < b.timestamp || p.deadline > b.timestamp + 60n) throw new ServiceError('conversion_policy_changed')
    if (!same(await recoverTypedDataAddress({ ...conversionTyped(e.to, p, d.chainId), signature: args[1] as Hex }), c.expectedSigner)) throw new ServiceError('conversion_state_changed')
    if (initialProof) { await assertCanonical(rpc, b); return }
    const [balance, exempt, tax, used] = await Promise.all([
      read<bigint>(rpc, project.token.address, 'function balanceOf(address) view returns(uint256)', [e.to], b.number),
      read<boolean>(rpc, project.token.address, 'function taxExempt(address) view returns(bool)', [e.to], b.number),
      read<number>(rpc, project.token.address, 'function taxSellBps() view returns(uint16)', [], b.number),
      read<boolean>(rpc, e.to, 'function usedConversionNonce(uint256) view returns(bool)', [p.nonce], b.number),
    ])
    if (balance < p.input || tax !== 100 || used) throw new ServiceError('conversion_state_changed')
    const effective = exempt ? p.input : p.input - p.input * BigInt(tax) / 10000n
    const quote = await read<readonly bigint[]>(rpc, d.contracts.router.address, 'function getAmountsOut(uint256,address[]) view returns(uint256[])',
      [effective, [project.token.address, d.contracts.fab.address]], b.number)
    if (quote.length !== 2 || quote[0] !== effective || quote[1] <= 0n || p.minimumFab < quote[1] * BigInt(10000 - c.policy.slippageBps) / 10000n) throw new ServiceError('conversion_state_changed')
  }
  await assertCanonical(rpc, b)
}
