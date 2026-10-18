import type { MiningProductDeployment } from '../../../mining-products'
import { apiPath } from '../lib/apiPath'
import { indexBlock, validIndexStatus, type ChainIndexStatus, type IndexBlock } from '../data/indexStatus'

export interface MiningChainEvent {
  id: string; address: string; event: string; blockNumber: number; blockHash: string
  transactionHash: string; logIndex: number; args: Record<string, string | number | boolean>
  transactionFrom: string | null; timestamp: number
}
export interface MiningHistoryPage {
  schemaVersion: 1; chainId: 1952; deploymentVersion: string; asOf: IndexBlock | null
  events: MiningChainEvent[]; nextCursor: string | null; index: ChainIndexStatus
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const uint = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const hash = (value: unknown): value is string => typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value)
const address = (value: unknown): value is string => typeof value === 'string' && /^0x[\da-f]{40}$/i.test(value)
function event(value: unknown): boolean {
  return record(value) && typeof value.id === 'string' && address(value.address) &&
    typeof value.event === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,80}$/.test(value.event) &&
    uint(value.blockNumber) && uint(value.logIndex) && uint(value.timestamp) && value.timestamp <= 8_640_000_000_000 && hash(value.blockHash) && hash(value.transactionHash) &&
    (value.transactionFrom === null || address(value.transactionFrom)) && record(value.args) &&
    Object.values(value.args).every((arg) => typeof arg === 'string' || typeof arg === 'boolean' || (typeof arg === 'number' && Number.isSafeInteger(arg)))
}
export class MiningIndexError extends Error {
  constructor(readonly restart: boolean) { super(restart ? 'indexRestart' : 'indexUnavailable') }
}
export async function loadMiningHistory(d: MiningProductDeployment, query: { owner?: string; cursor?: string }, signal?: AbortSignal): Promise<MiningHistoryPage> {
  const params = new URLSearchParams(query)
  const response = await fetch(apiPath(`/api/index/events?${params}`), { signal, credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new MiningIndexError(response.status === 409)
  const value: unknown = await response.json()
  if (!record(value) || value.schemaVersion !== 1 || value.chainId !== 1952 || value.deploymentVersion !== d.version ||
    !indexBlock(value.asOf) || !validIndexStatus(value.index, 1952, d.version) ||
    !Array.isArray(value.events) || value.events.length > 10 || !value.events.every(event) ||
    !(value.nextCursor === null || (typeof value.nextCursor === 'string' && value.nextCursor.length > 0)) ||
    new Set(value.events.map((row) => row.id)).size !== value.events.length) throw new MiningIndexError(false)
  const indexedThrough = value.index.indexedThrough
  if (value.events.some((row) => row.blockNumber > indexedThrough)) throw new MiningIndexError(false)
  return value as unknown as MiningHistoryPage
}
