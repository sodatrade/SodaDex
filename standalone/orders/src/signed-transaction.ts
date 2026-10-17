import { keccak256, parseTransaction, recoverTransactionAddress, type Address, type Hex, type TransactionSerialized } from 'viem'
import { executionData } from './chain.ts'
import type { ExecutionPlan } from './chain-types.ts'
import type { SodaLimitOrder } from '../../order-types.ts'
export async function validateSignedExecution(raw: Hex, plan: ExecutionPlan, signer: Address): Promise<Hex> {
  const tx = parseTransaction(raw)
  const from = await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })
  if (from.toLowerCase() !== signer.toLowerCase() || tx.chainId !== 196 || tx.to?.toLowerCase() !== plan.to.toLowerCase() || tx.data?.toLowerCase() !== plan.data.toLowerCase() || (tx.value ?? 0n) !== 0n || tx.nonce !== plan.nonce || tx.gas !== plan.gas || tx.gasPrice !== plan.gasPrice || tx.type !== 'legacy') throw Error('Signer returned a transaction outside the approved execution plan')
  return keccak256(raw)
}
export async function validateStoredExecution(raw: Hex, hash: Hex, signer: Address, nonce: number, maxCostWei: bigint, order: SodaLimitOrder, signature: Hex): Promise<void> {
  const tx = parseTransaction(raw)
  if (tx.gas === undefined || tx.gasPrice === undefined || tx.gas * tx.gasPrice !== maxCostWei) throw Error('Stored execution gas commitment mismatch')
  const actual = await validateSignedExecution(raw, { chainId: 196, to: order.settlement, data: executionData(order, signature), value: 0n, nonce, gas: tx.gas, gasPrice: tx.gasPrice }, signer)
  if (actual !== hash) throw Error('Stored execution hash mismatch')
}
