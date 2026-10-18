import type { Abi } from 'viem'
import type { NetworkProfile } from '../../../network-profile'
import type { Block, ChainLog, Pool } from '../dex-data'
import type { MiningApiBinding } from '../mining-api'
export interface IndexSource { address: string; abi: Abi; protocol: 'v3' | 'v4' | 'mining'; role: string }
export interface IndexConfig { profile: NetworkProfile; version: string; fromBlock: number; sources: IndexSource[] }
export interface IndexedEvent {
  id: string; protocol: 'v3' | 'v4' | 'mining'; address: string; event: string; blockNumber: number; blockHash: string
  transactionHash: string; logIndex: number; args: Record<string, string | number | boolean>; transactionFrom: string; timestamp: number
}
export interface IndexStatus {
  schemaVersion: 1; chainId: 196 | 1952; deploymentVersion: string; head: Block | null; indexedThrough: number
  fromBlock: number; syncing: boolean; lastError: string | null; generation: number
}
export type SqlValue = string | number | null
export interface Storage {
  sql: { exec(query: string, ...values: SqlValue[]): { toArray(): Record<string, SqlValue>[] } }
  transactionSync<T>(operation: () => T): T
  getAlarm(): Promise<number | null>; setAlarm(timestamp: number): Promise<void>
}
export interface IndexEnv {
  CHAIN_INDEX?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
  MINING_API?: MiningApiBinding
}
export interface Batch { from: number; to: Block; head: Block; logs: ChainLog[]; events: IndexedEvent[]; pools: Pool[] }
export interface SavedCursor { query: string; generation: number; through: number; asOf: Block | null; offset: number; expires: number }
