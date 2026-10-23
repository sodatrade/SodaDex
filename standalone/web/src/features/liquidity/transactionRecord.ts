import { isAddress, type Address, type Hex } from 'viem'
import { CHAIN_ID } from '../../domain/assets'
import type { LiquidityProtocol } from '../../liquidity/types'
export interface LiquidityRecord {
  chainId: 196
  hash: Hex
  from: Address
  to: Address
  protocol: LiquidityProtocol
  kind: 'approval' | 'liquidity'
  status: 'pending' | 'success' | 'reverted'
}
export const LP_RECORD_KEY = 'sodadex.liquidity.transaction.v1'
export function readRecord(): LiquidityRecord | undefined {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LP_RECORD_KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return
    const r = raw as Record<string, unknown>
    if (
      r.chainId !== CHAIN_ID ||
      typeof r.hash !== 'string' ||
      !/^0x[0-9a-fA-F]{64}$/.test(r.hash) ||
      typeof r.from !== 'string' ||
      !isAddress(r.from, { strict: false }) ||
      typeof r.to !== 'string' ||
      !isAddress(r.to, { strict: false }) ||
      !['v3', 'v4'].includes(String(r.protocol)) ||
      !['approval', 'liquidity'].includes(String(r.kind)) ||
      !['pending', 'success', 'reverted'].includes(String(r.status))
    )
      return
    return r as unknown as LiquidityRecord
  } catch {
    return
  }
}
export function writeRecord(record: LiquidityRecord): boolean {
  try {
    localStorage.setItem(LP_RECORD_KEY, JSON.stringify(record))
    return true
  } catch {
    return false
  }
}
