import { decodeFunctionData, encodeFunctionData, parseAbi, recoverTransactionAddress, parseTransaction, keccak256, type Hex, type TransactionSerialized, type TransactionSerializableLegacy } from 'viem'
import { MINING_PRODUCT_WRITE_ABI } from '../../mining-abi.ts'
import type { MiningProductDeployment, MiningProject } from '../../mining-products.ts'
import { same, ServiceError, type Execution, type PreparedCall } from './types.ts'
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
  if (!same(from, signer) || tx.chainId !== 1952 || tx.type !== 'legacy' || !same(tx.to ?? '', plan.to ?? '') ||
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
    chainId: 1952, to: e.to, data: e.data, value: 0n, nonce: e.nonce, gas: BigInt(e.gas), gasPrice: BigInt(e.gasPrice), type: 'legacy',
  }, e.signer) !== e.hash) throw new ServiceError('stored_transaction_invalid', 503)
}
