import { hashTypedData, type Address, type Hex } from 'viem'
import { orderTypedData, parseLimitOrder, type SodaLimitOrder } from '../../../../order-types'
import { WOKB_ADDRESS } from '../../domain/assets'
import { CONTRACTS } from '../../trading/config'
import type { OrderDeployment } from './config'
export type OrderStatus = 'open' | 'pending' | 'filled' | 'cancelled' | 'expired'
export type OrderReason = 'awaiting_price' | 'simulation_failed' | 'execution_disabled' | 'gas_budget' | 'broadcast_unknown' | 'transaction_reverted' | 'chain_unavailable' | null
export interface PublicOrder {
  id: Hex; order: SodaLimitOrder; status: OrderStatus; reason: OrderReason; txHash: Hex | null; createdAt: number; updatedAt: number
  observation: { blockNumber: string; blockHash: Hex; timestamp: number } | null
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const hash = (v: unknown): v is Hex => typeof v === 'string' && /^0x[\da-f]{64}$/i.test(v)
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const reasons = ['awaiting_price', 'simulation_failed', 'execution_disabled', 'gas_budget', 'broadcast_unknown', 'transaction_reverted', 'chain_unavailable']
export function decodeOrder(value: unknown, deployment: OrderDeployment): PublicOrder {
  if (!record(value) || !hash(value.id) || !['open', 'pending', 'filled', 'cancelled', 'expired'].includes(String(value.status)) ||
    !(value.reason === null || reasons.includes(String(value.reason))) || !(value.txHash === null || hash(value.txHash)) ||
    !integer(value.createdAt) || !integer(value.updatedAt) || value.updatedAt < value.createdAt ||
    !(value.observation === null || (record(value.observation) && typeof value.observation.blockNumber === 'string' && /^\d+$/.test(value.observation.blockNumber) &&
      hash(value.observation.blockHash) && integer(value.observation.timestamp)))) throw Error('Invalid order response')
  const order = parseLimitOrder(value.order, { ...CONTRACTS, settlement: deployment.settlement, wrappedNative: WOKB_ADDRESS })
  if (hashTypedData(orderTypedData(order, CONTRACTS.permit2)).toLowerCase() !== value.id.toLowerCase()) throw Error('Order digest mismatch')
  return { id: value.id, order, status: value.status, reason: value.reason, txHash: value.txHash,
    createdAt: value.createdAt, updatedAt: value.updatedAt, observation: value.observation } as PublicOrder
}
async function request(path: string, init?: RequestInit, allowMissing = false): Promise<unknown> {
  const response = await fetch(`/api/orders${path}`, { ...init, signal: AbortSignal.timeout(15_000) })
  if (allowMissing && response.status === 404) return undefined
  if (!response.ok) throw Error('Order service unavailable')
  return response.json() as Promise<unknown>
}
export async function getOrder(id: Hex, deployment: OrderDeployment): Promise<PublicOrder | undefined> {
  if (!hash(id)) throw Error('Invalid order digest')
  const value = await request(`/${id}`, undefined, true)
  if (value === undefined) return
  if (!record(value) || value.schemaVersion !== 1) throw Error('Invalid order response')
  const order = decodeOrder(value.order, deployment)
  if (order.id.toLowerCase() !== id.toLowerCase()) throw Error('Order response mismatch')
  return order
}
export async function orderServiceReady(deployment: OrderDeployment): Promise<boolean> {
  if (!deployment.executionEnabled) return false
  const value = await request('/status')
  return record(value) && value.schemaVersion === 1 && value.service === 'sodadex-orders' && value.chainId === 196 && value.testDeployment === true &&
    typeof value.settlement === 'string' && value.settlement.toLowerCase() === deployment.settlement.toLowerCase() && value.reason === null &&
    typeof value.permit2 === 'string' && value.permit2.toLowerCase() === CONTRACTS.permit2.toLowerCase() &&
    typeof value.wrappedNative === 'string' && value.wrappedNative.toLowerCase() === WOKB_ADDRESS.toLowerCase() &&
    value.executionEnabled === true && value.acceptingOrders === true
}
export async function submitOrder(order: SodaLimitOrder, signature: Hex, deployment: OrderDeployment): Promise<PublicOrder> {
  if (!deployment.executionEnabled) throw Error('New orders are paused')
  const value = await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order, signature }) })
  if (!record(value) || value.schemaVersion !== 1) throw Error('Invalid order response')
  const result = decodeOrder(value.order, deployment)
  if (result.id.toLowerCase() !== hashTypedData(orderTypedData(order, CONTRACTS.permit2)).toLowerCase()) throw Error('Order response mismatch')
  return result
}
export async function listOrders(maker: Address, deployment: OrderDeployment, cursor?: string): Promise<{ orders: PublicOrder[]; nextCursor: string | null }> {
  const value = await request(`?${new URLSearchParams({ maker, limit: '20', ...(cursor ? { cursor } : {}) })}`)
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.orders) || !(value.nextCursor === null || typeof value.nextCursor === 'string')) throw Error('Invalid order list')
  const orders = value.orders.map(v => decodeOrder(v, deployment))
  if (orders.some(v => v.order.maker.toLowerCase() !== maker.toLowerCase())) throw Error('Order owner mismatch')
  return { orders, nextCursor: value.nextCursor }
}
