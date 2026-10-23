import { assertZeroAdditionalFees, serializedBytes } from './fees.ts'
import { assertCanonical, block } from './rpc.ts'
import { hash, quantity, record, same, ServiceError, type Block, type Execution, type Rpc } from './types.ts'
export interface CanonicalReceipt { block: Block; status: 'confirmed' | 'reverted'; cost: bigint }
/** The ordinary and replacement paths share the same canonical receipt and fee policy. */
export async function executionReceipt(rpc: Rpc, e: Execution): Promise<CanonicalReceipt | undefined> {
  const receipt = await rpc.request('eth_getTransactionReceipt', [e.hash])
  if (receipt === null) return undefined
  if (!record(receipt) || !same(String(receipt.transactionHash), e.hash) || typeof receipt.blockNumber !== 'string' || !hash(receipt.blockHash)) throw new ServiceError('receipt_invalid', 503)
  const b = await block(rpc, receipt.blockNumber)
  if (!same(b.hash, receipt.blockHash)) throw new ServiceError('receipt_reorg', 503)
  const status = quantity(receipt.status)
  if (status !== 0n && status !== 1n) throw new ServiceError('receipt_invalid', 503)
  const gasUsed = quantity(receipt.gasUsed), price = quantity(receipt.effectiveGasPrice)
  const cost = gasUsed * price + (receipt.l1Fee === undefined ? 0n : quantity(receipt.l1Fee)) + (receipt.operatorFee === undefined ? 0n : quantity(receipt.operatorFee))
  if (gasUsed > BigInt(e.gas) || price > BigInt(e.gasPrice) || cost > BigInt(e.maxCostWei)) throw new ServiceError('receipt_cost_exceeds_reserve', 503)
  await assertZeroAdditionalFees(rpc, serializedBytes(e.raw), BigInt(e.gas), b.number)
  await assertCanonical(rpc, b)
  return { block: b, status: status === 1n ? 'confirmed' : 'reverted', cost }
}
