import type { FragmentDeployment } from './config'
import { formatEther } from 'viem'
import { compactTinyDecimal, compactMarketNumber } from '../domain/compactDecimal'
export interface Trade { id: string; transactionHash: string; timestamp: number; blockNumber: number; shareIn: boolean; input: string; output: string; platformFee: string; lpFee: string }
export interface Market { pool: string; chainId: number; trades: Trade[]; chart: Trade[]; nextCursor: string | null; index: { syncing: boolean; lastError: string | null; indexedThrough: number; generation: number }; asOf: { timestamp: number } | null }
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object'
function validTrade(x: unknown): x is Trade {
  return record(x) && typeof x.id === 'string' && typeof x.transactionHash === 'string' && /^0x[0-9a-f]{64}$/i.test(x.transactionHash) &&
    Number.isSafeInteger(x.timestamp) && Number.isSafeInteger(x.blockNumber) && typeof x.shareIn === 'boolean' &&
    ['input','output','platformFee','lpFee'].every(k => typeof x[k] === 'string' && /^\d{1,78}$/.test(x[k] as string))
}
export class ExpiredMarketPage extends Error {}
export async function readMarket(d: FragmentDeployment, cursor: string | undefined, signal: AbortSignal): Promise<Market> {
  const response = await fetch(`/api/fragments/market${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal })
  if (response.status === 409) throw new ExpiredMarketPage('Expired page')
  if (!response.ok) throw new Error('Market index unavailable')
  const data: unknown = await response.json()
  if (!record(data) || data.chainId !== d.chainId || typeof data.pool !== 'string' || data.pool.toLowerCase() !== d.pool.toLowerCase() ||
    !Array.isArray(data.trades) || data.trades.length > 10 || !data.trades.every(validTrade) || !Array.isArray(data.chart) || data.chart.length > 500 || !data.chart.every(validTrade) ||
    !(data.nextCursor === null || typeof data.nextCursor === 'string' && /^[0-9a-f-]{36}$/.test(data.nextCursor)) || !record(data.index) || typeof data.index.syncing !== 'boolean' || !Number.isSafeInteger(data.index.generation) ||
    !(data.index.lastError === null || typeof data.index.lastError === 'string') || !Number.isSafeInteger(data.index.indexedThrough) ||
    !(data.asOf === null || record(data.asOf) && Number.isSafeInteger(data.asOf.timestamp))) throw new Error('Invalid market index response')
  return data as unknown as Market
}
export function tradePrice(t: Trade): number {
  const input = BigInt(t.input), output = BigInt(t.output), fees = BigInt(t.platformFee) + BigInt(t.lpFee)
  const native = t.shareIn ? output + fees : input - fees, shares = t.shareIn ? input : output
  return shares > 0n && native >= 0n ? Number(native) / Number(shares) : 0
}
export function marketNumber(value: number): string { return compactMarketNumber(value) }

export function tradeAmount(raw: string): string {
  const decimal = formatEther(BigInt(raw))
  return compactTinyDecimal(decimal) ?? marketNumber(Number(decimal))
}
