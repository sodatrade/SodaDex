import type { Address, Hex } from 'viem'
import type { SodaLimitOrder } from '../../order-types.ts'
export type OrderStatus = 'open' | 'pending' | 'filled' | 'cancelled' | 'expired'
export type OrderReason = 'awaiting_price' | 'simulation_failed' | 'execution_disabled' | 'gas_budget' | 'broadcast_unknown' | 'transaction_reverted' | 'chain_unavailable' | 'nonce_unavailable' | null
export interface ChainObservation { blockNumber: string; blockHash: Hex; timestamp: number }
export interface PublicOrder {
  id: Hex; order: SodaLimitOrder; status: OrderStatus; reason: OrderReason; txHash: Hex | null
  createdAt: number; updatedAt: number; observation: ChainObservation | null
}
export interface OrdersStatus {
  schemaVersion: 1; service: 'sodadex-orders'; chainId: 196; settlement: Address | null; permit2: Address; wrappedNative: Address
  testDeployment: true; executionEnabled: boolean; acceptingOrders: boolean; reason: 'NOT_DEPLOYED' | 'CHAIN_UNAVAILABLE' | 'EXECUTION_PAUSED' | null
}
export interface OrderResponse { schemaVersion: 1; order: PublicOrder }
export interface OrderListResponse { schemaVersion: 1; orders: PublicOrder[]; nextCursor: string | null }
export interface OrdersError { error: string; code: string }
