import { hashTypedData, type Hex } from 'viem'
import { orderTypedData, parseLimitOrder, type SodaLimitOrder } from '../../../../order-types'
import { WOKB_ADDRESS } from '../../domain/assets'
import { CONTRACTS } from '../../trading/config'
import type { OrderDeployment } from './config'
export interface OrderSubmission { id: Hex; order: SodaLimitOrder; submittedAt: number }
const key = 'sodadex.order-submissions.v1'
/** Only the public order and digest survive reloads. Never persist its Permit2 signature. */
export function readOrderSubmissions(deployment: OrderDeployment): OrderSubmission[] {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(values)) return []
    return values.flatMap((value) => {
      try {
        if (!value || typeof value !== 'object') return []
        const v = value as Record<string, unknown>, order = parseLimitOrder(v.order, { ...CONTRACTS, settlement: deployment.settlement, wrappedNative: WOKB_ADDRESS })
        const id = hashTypedData(orderTypedData(order, CONTRACTS.permit2))
        if (v.id !== id || typeof v.submittedAt !== 'number' || !Number.isSafeInteger(v.submittedAt)) return []
        return [{ id, order, submittedAt: v.submittedAt }]
      } catch { return [] }
    })
  } catch { return [] }
}
export function saveOrderSubmission(record: OrderSubmission, deployment: OrderDeployment): void {
  try { localStorage.setItem(key, JSON.stringify([record, ...readOrderSubmissions(deployment).filter((v) => v.id !== record.id)])) } catch { /* Keep the digest visible in memory if storage is unavailable. */ }
}
