import type { SqlValue } from '../src/sql.ts'
export interface SqlCursor { toArray(): Record<string, SqlValue>[] }
export interface ObjectStorage {
  sql: { exec(query: string, ...bindings: SqlValue[]): SqlCursor }
  transactionSync<T>(operation: () => T): T
  sync(): Promise<void>
  getAlarm(): Promise<number | null>
  setAlarm(timestamp: number): Promise<void>
  deleteAlarm(): Promise<void>
}
export interface ObjectState { storage: ObjectStorage }
export interface OrdersEnv {
  ORDERS: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
  ORDERS_PUBLIC_ORIGIN?: string
  ORDERS_POLL_MS?: string
  ORDERS_EXECUTION_ENABLED?: string
  ORDERS_GAS_BUDGET_WEI?: string
  ORDERS_KEEPER_ADDRESS?: string
  ORDERS_KEEPER_PRIVATE_KEY?: string
}
