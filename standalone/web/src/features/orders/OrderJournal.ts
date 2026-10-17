import { hashTypedData, type Hex } from 'viem'
import { orderTypedData, parseLimitOrder, type SodaLimitOrder } from '../../../../order-types'
import { WOKB_ADDRESS } from '../../domain/assets'
import { CONTRACTS } from '../../trading/config'
import type { OrderChainState } from './signing'
import type { OrderDeployment } from './config'
export interface OrderSubmission { id: Hex; order: SodaLimitOrder; submittedAt: number; recovery?: OrderChainState; released?: boolean; releaseSource?: 'service' | 'chain' }
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
        const recovery = readRecovery(v.recovery)
        // These are public focus markers, never proof that a signature is invalid or a service is ready.
        const released = v.released === true && (v.releaseSource === 'service' || (recovery && recovery.status !== 'open'))
        return [{ id, order, submittedAt: v.submittedAt, ...(recovery ? { recovery } : {}), ...(released ? { released: true, releaseSource: v.releaseSource === 'service' ? 'service' as const : 'chain' as const } : {}) }]
      } catch { return [] }
    })
  } catch { return [] }
}
export function saveOrderSubmission(record: OrderSubmission, deployment: OrderDeployment): void {
  try { localStorage.setItem(key, JSON.stringify([record, ...readOrderSubmissions(deployment).filter((v) => v.id !== record.id)])) } catch { /* Keep the digest visible in memory if storage is unavailable. */ }
}

function readRecovery(value: unknown): OrderChainState | undefined {
  if (!value || typeof value !== 'object') return
  const v = value as Record<string, unknown>
  if (!['open', 'cancelled', 'filled', 'expired'].includes(String(v.status)) || typeof v.blockNumber !== 'string' || !/^\d+$/.test(v.blockNumber) ||
    typeof v.blockHash !== 'string' || !/^0x[\da-f]{64}$/i.test(v.blockHash) || typeof v.timestamp !== 'number' || !Number.isSafeInteger(v.timestamp) || v.timestamp < 0) return
  return { status: v.status as OrderChainState['status'], blockNumber: v.blockNumber, blockHash: v.blockHash as Hex, timestamp: v.timestamp }
}
