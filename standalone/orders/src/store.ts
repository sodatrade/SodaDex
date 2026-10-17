import { DatabaseSync } from 'node:sqlite'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { keccak256, type Address, type Hex } from 'viem'
import type { SodaLimitOrder } from '../../order-types.ts'
import type { ChainObservation, OrderReason, OrderStatus, PublicOrder } from './types.ts'
const APPLICATION_ID = 0x534f4441
const terminal = (status: OrderStatus): boolean => ['filled', 'cancelled', 'expired'].includes(status)
interface OrderRow { id: Hex; maker: string; nonce: string; order_json: string; signature: Hex; status: OrderStatus; reason: OrderReason; tx_hash: Hex | null; created_at: number; updated_at: number; observation_json: string | null }
export interface StoredOrder { public: PublicOrder; signature: Hex }
export interface StoredExecution { id: number; orderId: Hex; hash: Hex; rawTransaction: Hex; signer: Address; nonce: number; maxCostWei: bigint; status: 'prepared' | 'broadcast' | 'confirmed' | 'reverted'; actualCostWei: bigint | null }
export class NonceConflict extends Error {}
export class GasBudgetExceeded extends Error {}
function view(row: OrderRow): PublicOrder {
  return { id: row.id, order: JSON.parse(row.order_json) as SodaLimitOrder, status: row.status, reason: row.reason, txHash: row.tx_hash, createdAt: row.created_at, updatedAt: row.updated_at, observation: row.observation_json ? JSON.parse(row.observation_json) as ChainObservation : null }
}
export class OrderStore {
  readonly database: DatabaseSync
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    if (!existsSync(path)) closeSync(openSync(path, 'wx', 0o600))
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw Error('Orders database must be a private regular file with mode 0600')
    const probe = new DatabaseSync(path, { readOnly: true })
    const application = probe.prepare('PRAGMA application_id').get() as { application_id: number }
    const version = probe.prepare('PRAGMA user_version').get() as {user_version: number}
    const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
    probe.close()
    if (application.application_id !== APPLICATION_ID && (application.application_id !== 0 || tables.length !== 0)) throw Error('Refusing a database not owned by SodaDEX orders')
    if (application.application_id === APPLICATION_ID && version.user_version !== 1) throw Error('Unsupported orders database version')
    this.database = new DatabaseSync(path)
    this.database.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,maker TEXT NOT NULL,nonce TEXT NOT NULL,order_json TEXT NOT NULL,signature TEXT NOT NULL,status TEXT NOT NULL,reason TEXT,tx_hash TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,observation_json TEXT,UNIQUE(maker,nonce));
      CREATE TABLE IF NOT EXISTS executions(id INTEGER PRIMARY KEY,order_id TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,raw_tx TEXT NOT NULL,signer TEXT NOT NULL,nonce INTEGER NOT NULL,max_cost TEXT NOT NULL,status TEXT NOT NULL,actual_cost TEXT,UNIQUE(signer,nonce));
      CREATE TABLE IF NOT EXISTS keeper_guard(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,pid INTEGER NOT NULL);`)
  }
  close(): void { this.database.close() }
  get(id: string): PublicOrder | null {
    const row = this.database.prepare('SELECT * FROM orders WHERE id=?').get(id) as unknown as OrderRow | undefined
    return row ? view(row) : null
  }
  privateOrder(id: string): StoredOrder | null {
    const row = this.database.prepare('SELECT * FROM orders WHERE id=?').get(id) as unknown as OrderRow | undefined
    return row ? { public: view(row), signature: row.signature } : null
  }
  insert(id: Hex, order: SodaLimitOrder, signature: Hex, observation: ChainObservation, now: number): { order: PublicOrder; created: boolean } {
    const result = this.database.prepare("INSERT OR IGNORE INTO orders(id,maker,nonce,order_json,signature,status,created_at,updated_at,observation_json) VALUES(?,?,?,?,?,'open',?,?,?)").run(id, order.maker.toLowerCase(), order.nonce, JSON.stringify(order), signature, now, now, JSON.stringify(observation))
    const row = this.database.prepare('SELECT * FROM orders WHERE maker=? AND nonce=?').get(order.maker.toLowerCase(), order.nonce) as unknown as OrderRow | undefined
    if (!row || row.id !== id || row.order_json !== JSON.stringify(order)) throw new NonceConflict('Maker nonce already belongs to another order')
    return { order: view(row), created: Number(result.changes) === 1 }
  }
  list(maker: string, limit: number, cursor?: string): { orders: PublicOrder[]; nextCursor: string | null } {
    const rows = this.database.prepare('SELECT rowid AS sequence,* FROM orders WHERE maker=? AND rowid<? ORDER BY rowid DESC LIMIT ?').all(maker.toLowerCase(), cursor ?? '9223372036854775807', limit + 1) as unknown as (OrderRow & { sequence: number })[]
    const selected = rows.slice(0, limit)
    return { orders: selected.map(view), nextCursor: rows.length > limit ? String(selected.at(-1)!.sequence) : null }
  }
  eligible(): PublicOrder[] { return (this.database.prepare("SELECT * FROM orders WHERE status IN ('open','pending') ORDER BY rowid").all() as unknown as OrderRow[]).map(view) }
  update(id: Hex, state: { status: OrderStatus; reason?: OrderReason; observation?: ChainObservation; txHash?: Hex | null }, now: number): PublicOrder {
    const current = this.get(id)
    if (!current) throw Error('Order not found')
    if (terminal(current.status) && state.status !== current.status) return current
    this.database.prepare('UPDATE orders SET status=?,reason=?,tx_hash=?,updated_at=?,observation_json=? WHERE id=?').run(state.status, state.reason ?? null, state.txHash === undefined ? current.txHash : state.txHash, now, state.observation ? JSON.stringify(state.observation) : JSON.stringify(current.observation), id)
    return this.get(id)!
  }
  acquire(owner: string): boolean {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const guard = this.database.prepare('SELECT * FROM keeper_guard WHERE id=1').get() as { owner: string; pid: number } | undefined
      let alive = false
      if (guard) { try { process.kill(guard.pid, 0); alive = true } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH' } }
      if (guard && alive) { this.database.exec('ROLLBACK'); return false }
      this.database.prepare('INSERT OR REPLACE INTO keeper_guard(id,owner,pid) VALUES(1,?,?)').run(owner, process.pid)
      this.database.exec('COMMIT'); return true
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
  release(owner: string): void { this.database.prepare('DELETE FROM keeper_guard WHERE id=1 AND owner=?').run(owner) }
  executions(): StoredExecution[] {
    const rows = this.database.prepare("SELECT * FROM executions WHERE status IN ('prepared','broadcast') ORDER BY id").all() as Record<string, unknown>[]
    return rows.map(row => ({ id: Number(row.id), orderId: row.order_id as Hex, hash: row.hash as Hex, rawTransaction: row.raw_tx as Hex, signer: row.signer as Address, nonce: Number(row.nonce), maxCostWei: BigInt(String(row.max_cost)), status: row.status as StoredExecution['status'], actualCostWei: row.actual_cost === null ? null : BigInt(String(row.actual_cost)) }))
  }
  gasCommitted(): bigint {
    return (this.database.prepare('SELECT max_cost,actual_cost FROM executions').all() as { max_cost: string; actual_cost: string | null }[]).reduce((sum, row) => sum + BigInt(row.actual_cost ?? row.max_cost), 0n)
  }
  prepare(orderId: Hex, hash: Hex, rawTransaction: Hex, signer: Address, nonce: number, maxCostWei: bigint, budgetWei: bigint, now: number): StoredExecution {
    if (keccak256(rawTransaction) !== hash) throw Error('Signed transaction hash mismatch')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (this.gasCommitted() + maxCostWei > budgetWei) throw new GasBudgetExceeded('Keeper gas budget exhausted')
      this.database.prepare("INSERT INTO executions(order_id,hash,raw_tx,signer,nonce,max_cost,status) VALUES(?,?,?,?,?,?,'prepared')").run(orderId, hash, rawTransaction, signer.toLowerCase(), nonce, String(maxCostWei))
      this.update(orderId, { status: 'pending', reason: 'broadcast_unknown', txHash: hash }, now)
      this.database.exec('COMMIT')
      return this.executions().find(attempt => attempt.hash === hash)!
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
  broadcast(hash: Hex): void { this.database.prepare("UPDATE executions SET status='broadcast' WHERE hash=? AND status='prepared'").run(hash) }
  finish(hash: Hex, succeeded: boolean, actualCostWei: bigint): void { this.database.prepare("UPDATE executions SET status=?,actual_cost=? WHERE hash=?").run(succeeded ? 'confirmed' : 'reverted', String(actualCostWei), hash) }
}
