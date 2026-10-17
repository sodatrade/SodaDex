import type { Address, Hex } from 'viem'
import type { SodaLimitOrder } from '../../order-types.ts'
import type { ChainObservation } from './types.ts'
export interface NonceObservation { observation: ChainObservation; nonceStatus: 0 | 1 | 2; permitNonceUsed: boolean }
export interface ExecutionPlan { chainId: 196; to: Address; data: Hex; value: 0n; nonce: number; gas: bigint; gasPrice: bigint }
export interface ExecutionSigner { address: Address; signTransaction(plan: ExecutionPlan): Promise<Hex> }
export interface ExecutionReceipt { hash: Hex; succeeded: boolean; gasCostWei: bigint; observation: ChainObservation; filled: boolean }
export interface OrderChain {
  ready(): Promise<boolean>
  observe(order: SodaLimitOrder): Promise<NonceObservation>
  verifySignature(order: SodaLimitOrder, signature: Hex, observation: ChainObservation): Promise<boolean>
  simulate(order: SodaLimitOrder, signature: Hex, executor: Address): Promise<bigint>
  plan(order: SodaLimitOrder, signature: Hex, executor: Address): Promise<ExecutionPlan>
  receipt(hash: Hex, order: SodaLimitOrder): Promise<ExecutionReceipt | null>
  broadcast(rawTransaction: Hex): Promise<Hex>
}
export class ChainFailure extends Error {
  readonly kind: 'unavailable' | 'simulation' | 'price'
  constructor(kind: ChainFailure['kind']) { super('Order chain operation failed'); this.kind = kind }
}
