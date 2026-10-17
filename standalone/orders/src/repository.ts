import { keccak256, type Address, type Hex } from 'viem'
import type { SodaLimitOrder } from '../../order-types.ts'
import type { ChainObservation, OrderReason, OrderStatus, PublicOrder } from './types.ts'
import type { KeeperNonceObservation } from './chain-types.ts'
import type { SqlDriver, KeeperGuard } from './sql.ts'
const terminal = (status: OrderStatus): boolean => ['filled', 'cancelled', 'expired'].includes(status)
interface OrderRow { id: Hex; maker: string; nonce: string; order_json: string; signature: Hex; status: OrderStatus; reason: OrderReason; tx_hash: Hex | null; created_at: number; updated_at: number; observation_json: string | null }
export interface StoredOrder { public: PublicOrder; signature: Hex }
export interface StoredExecution { id: number; orderId: Hex; hash: Hex; rawTransaction: Hex; signer: Address; nonce: number; maxCostWei: bigint; status: 'prepared' | 'broadcast' | 'confirmed' | 'reverted' | 'nonce_consumed'; actualCostWei: bigint | null }
interface OrderUpdate { status: OrderStatus; reason?: OrderReason; observation?: ChainObservation; txHash?: Hex | null }
function execution(row: Record<string, unknown>): StoredExecution {
  return { id: Number(row.id), orderId: row.order_id as Hex, hash: row.hash as Hex, rawTransaction: row.raw_tx as Hex, signer: row.signer as Address, nonce: Number(row.nonce), maxCostWei: BigInt(String(row.max_cost)), status: row.status as StoredExecution['status'], actualCostWei: row.actual_cost === null ? null : BigInt(String(row.actual_cost)) }
}
export class NonceConflict extends Error {}
export class GasBudgetExceeded extends Error {}
function view(row: OrderRow): PublicOrder {
  return { id: row.id, order: JSON.parse(row.order_json) as SodaLimitOrder, status: row.status, reason: row.reason, txHash: row.tx_hash, createdAt: row.created_at, updatedAt: row.updated_at, observation: row.observation_json ? JSON.parse(row.observation_json) as ChainObservation : null }
}
export class OrderRepository {
  readonly driver: SqlDriver
  readonly guard: KeeperGuard
  constructor(driver: SqlDriver, guard: KeeperGuard) {
    this.driver = driver; this.guard = guard
    driver.exec(`CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,maker TEXT NOT NULL,nonce TEXT NOT NULL,order_json TEXT NOT NULL,signature TEXT NOT NULL,status TEXT NOT NULL,reason TEXT,tx_hash TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,observation_json TEXT,UNIQUE(maker,nonce));
      CREATE TABLE IF NOT EXISTS executions(id INTEGER PRIMARY KEY,order_id TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,raw_tx TEXT NOT NULL,signer TEXT NOT NULL,nonce INTEGER NOT NULL,max_cost TEXT NOT NULL,status TEXT NOT NULL,actual_cost TEXT,UNIQUE(signer,nonce));
      CREATE TABLE IF NOT EXISTS execution_resolutions(hash TEXT PRIMARY KEY,observation_json TEXT NOT NULL,confirmed_nonce INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS keeper_progress(id INTEGER PRIMARY KEY CHECK(id=1),sequence INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS keeper_budget(id INTEGER PRIMARY KEY CHECK(id=1),total TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS read_progress(maker TEXT PRIMARY KEY,position INTEGER NOT NULL);`)
    if (!driver.prepare('SELECT 1 FROM keeper_budget WHERE id=1').get()) {
      const rows = driver.prepare('SELECT max_cost,actual_cost FROM executions').all() as {max_cost: string;actual_cost: string|null}[]
      const total = rows.reduce((sum, row) => sum + BigInt(row.actual_cost ?? row.max_cost), 0n)
      driver.prepare('INSERT OR IGNORE INTO keeper_budget(id,total) VALUES(1,?)').run(String(total))
    }
  }
  get(id: string): PublicOrder | null {
    const row = this.driver.prepare('SELECT * FROM orders WHERE id=?').get(id) as unknown as OrderRow | undefined
    return row ? view(row) : null
  }
  privateOrder(id: string): StoredOrder | null {
    const row = this.driver.prepare('SELECT * FROM orders WHERE id=?').get(id) as unknown as OrderRow | undefined
    return row ? { public: view(row), signature: row.signature } : null
  }
  insert(id: Hex, order: SodaLimitOrder, signature: Hex, observation: ChainObservation, now: number): { order: PublicOrder; created: boolean } {
    const result = this.driver.prepare("INSERT OR IGNORE INTO orders(id,maker,nonce,order_json,signature,status,created_at,updated_at,observation_json) VALUES(?,?,?,?,?,'open',?,?,?)").run(id, order.maker.toLowerCase(), order.nonce, JSON.stringify(order), signature, now, now, JSON.stringify(observation))
    const row = this.driver.prepare('SELECT * FROM orders WHERE maker=? AND nonce=?').get(order.maker.toLowerCase(), order.nonce) as unknown as OrderRow | undefined
    if (!row || row.id !== id || row.order_json !== JSON.stringify(order)) throw new NonceConflict('Maker nonce already belongs to another order')
    return { order: view(row), created: Number(result.changes) === 1 }
  }
  list(maker: string, limit: number, cursor?: string): { orders: PublicOrder[]; nextCursor: string | null } {
    const rows = this.driver.prepare('SELECT rowid AS sequence,* FROM orders WHERE maker=? AND rowid<? ORDER BY rowid DESC LIMIT ?').all(maker.toLowerCase(), cursor ?? '9223372036854775807', limit + 1) as unknown as (OrderRow & { sequence: number })[]
    const selected = rows.slice(0, limit)
    return { orders: selected.map(view), nextCursor: rows.length > limit ? String(selected.at(-1)!.sequence) : null }
  }
  refreshIds(maker: string, ids: Hex[], limit: number): Hex[] {
    if (ids.length <= limit) return ids
    const prior = this.driver.prepare('SELECT position FROM read_progress WHERE maker=?').get(maker.toLowerCase()) as {position: number} | undefined
    const position = (prior?.position ?? 0) % ids.length
    const selected = Array.from({ length: limit }, (_, index) => ids[(position + index) % ids.length])
    this.driver.prepare('INSERT OR REPLACE INTO read_progress(maker,position) VALUES(?,?)').run(maker.toLowerCase(), (position + limit) % ids.length)
    return selected
  }
  hasWork(): boolean { return this.hasAnyExecution() || !!this.driver.prepare("SELECT 1 FROM orders WHERE status IN ('open','pending') LIMIT 1").get() }
  hasAnyExecution(): boolean { return !!this.driver.prepare("SELECT 1 FROM executions WHERE status IN ('prepared','broadcast') LIMIT 1").get() }
  eligible(): PublicOrder[] { return (this.driver.prepare("SELECT * FROM orders WHERE status IN ('open','pending') ORDER BY rowid").all() as unknown as OrderRow[]).map(view) }
  nextEligible(limit: number): PublicOrder[] {
    const progress = this.driver.prepare('SELECT sequence FROM keeper_progress WHERE id=1').get() as { sequence: number } | undefined
    const cursor = progress?.sequence ?? 0
    const rows = this.driver.prepare("SELECT rowid AS sequence,* FROM orders WHERE status IN ('open','pending') AND rowid>? ORDER BY rowid LIMIT ?").all(cursor, limit) as (OrderRow & {sequence: number})[]
    if (rows.length < limit) rows.push(...this.driver.prepare("SELECT rowid AS sequence,* FROM orders WHERE status IN ('open','pending') AND rowid<=? ORDER BY rowid LIMIT ?").all(cursor, limit - rows.length) as (OrderRow & {sequence: number})[])
    if (rows.length) this.driver.prepare('INSERT OR REPLACE INTO keeper_progress(id,sequence) VALUES(1,?)').run(rows.at(-1)!.sequence)
    return rows.map(view)
  }
  update(id: Hex, state: OrderUpdate, now: number): PublicOrder {
    const current = this.get(id)
    if (!current) throw Error('Order not found')
    if (terminal(current.status) && state.status !== current.status) return current
    this.driver.prepare('UPDATE orders SET status=?,reason=?,tx_hash=?,updated_at=?,observation_json=? WHERE id=?').run(state.status, state.reason ?? null, state.txHash === undefined ? current.txHash : state.txHash, now, state.observation ? JSON.stringify(state.observation) : JSON.stringify(current.observation), id)
    return this.get(id)!
  }
  hasExecution(id: Hex, includeFinished = false): boolean {
    return !!this.driver.prepare(`SELECT 1 FROM executions WHERE order_id=? ${includeFinished ? '' : "AND status IN ('prepared','broadcast')"} LIMIT 1`).get(id)
  }
  // Only an authoritative, hash-checked chain observation may undo a terminal state.
  // Compare the caller's starting observation so a delayed HTTP read cannot undo a newer result.
  applyChainObservation(expected: PublicOrder, state: OrderUpdate & { observation: ChainObservation }, previousCanonical: boolean | null, now: number): PublicOrder {
    return this.driver.transaction(() => {
      const current = this.get(expected.id)
      if (!current) throw Error('Order not found')
      if (current.status !== expected.status || JSON.stringify(current.observation) !== JSON.stringify(expected.observation)) { return current }
      if (terminal(current.status) && current.status !== state.status && previousCanonical === false) {
        // A reverted chain can make a previously mined keeper nonce usable again. Recover its exact raw transaction first.
        const rows = this.driver.prepare("SELECT * FROM executions WHERE order_id=? AND status IN ('confirmed','reverted','nonce_consumed')").all(current.id) as Record<string, unknown>[]
        for (const row of rows) this.setExecutionCost(execution(row), null, 'prepared')
        this.driver.prepare('DELETE FROM execution_resolutions WHERE hash IN (SELECT hash FROM executions WHERE order_id=?)').run(current.id)
      }
      const txHash = state.txHash === undefined ? previousCanonical === false && terminal(current.status) && !this.hasExecution(current.id) ? null : current.txHash : state.txHash
      this.driver.prepare('UPDATE orders SET status=?,reason=?,tx_hash=?,updated_at=?,observation_json=? WHERE id=?').run(state.status, state.reason ?? null, txHash, now, JSON.stringify(state.observation), current.id)
      return this.get(current.id)!
    })
  }
  durable(): Promise<void> { return this.driver.sync?.() ?? Promise.resolve() }
  acquire(owner: string): boolean { return this.guard.acquire(owner) }
  release(owner: string): void { this.guard.release(owner) }
  executions(limit = 16): StoredExecution[] {
    const rows = this.driver.prepare("SELECT * FROM executions WHERE status IN ('prepared','broadcast') ORDER BY id LIMIT ?").all(limit) as Record<string, unknown>[]
    return rows.map(execution)
  }
  executionAtNonce(signer: Address, nonce: number): StoredExecution | null {
    const row = this.driver.prepare('SELECT * FROM executions WHERE signer=? AND nonce=?').get(signer.toLowerCase(), nonce)
    return row ? execution(row as Record<string, unknown>) : null
  }
  restoreExecution(attempt: StoredExecution, state: KeeperNonceObservation): void {
    if (state.nonce > attempt.nonce) throw Error('Keeper nonce is still consumed on the observed chain')
    return this.driver.transaction(() => {
      this.setExecutionCost(attempt, null, 'prepared')
      this.driver.prepare('DELETE FROM execution_resolutions WHERE hash=?').run(attempt.hash)
    })
  }
  gasCommitted(): bigint { return BigInt((this.driver.prepare('SELECT total FROM keeper_budget WHERE id=1').get() as {total: string}).total) }
  private setExecutionCost(attempt: StoredExecution, actual: bigint | null, status: StoredExecution['status']): void {
    const row = this.driver.prepare('SELECT * FROM executions WHERE hash=?').get(attempt.hash) as Record<string, unknown> | undefined
    if (!row) throw Error('Execution not found')
    const current = execution(row)
    const total = this.gasCommitted() - (current.actualCostWei ?? current.maxCostWei) + (actual ?? current.maxCostWei)
    this.driver.prepare('UPDATE keeper_budget SET total=? WHERE id=1').run(String(total))
    this.driver.prepare('UPDATE executions SET status=?,actual_cost=? WHERE hash=?').run(status, actual === null ? null : String(actual), attempt.hash)
  }
  prepare(orderId: Hex, hash: Hex, rawTransaction: Hex, signer: Address, nonce: number, maxCostWei: bigint, budgetWei: bigint, now: number): StoredExecution {
    if (keccak256(rawTransaction) !== hash) throw Error('Signed transaction hash mismatch')
    return this.driver.transaction(() => {
      if (this.gasCommitted() + maxCostWei > budgetWei) throw new GasBudgetExceeded('Keeper gas budget exhausted')
      this.driver.prepare("INSERT INTO executions(order_id,hash,raw_tx,signer,nonce,max_cost,status) VALUES(?,?,?,?,?,?,'prepared')").run(orderId, hash, rawTransaction, signer.toLowerCase(), nonce, String(maxCostWei))
      this.driver.prepare('UPDATE keeper_budget SET total=? WHERE id=1').run(String(this.gasCommitted() + maxCostWei))
      this.update(orderId, { status: 'pending', reason: 'broadcast_unknown', txHash: hash }, now)
      return this.executions().find(attempt => attempt.hash === hash)!
    })
  }
  broadcast(hash: Hex): void { this.driver.prepare("UPDATE executions SET status='broadcast' WHERE hash=? AND status='prepared'").run(hash) }
  finish(hash: Hex, succeeded: boolean, actualCostWei: bigint): void {
    this.driver.transaction(() => {
      const row = this.driver.prepare('SELECT * FROM executions WHERE hash=?').get(hash) as Record<string, unknown> | undefined
      if (!row) throw Error('Execution not found')
      this.setExecutionCost(execution(row), actualCostWei, succeeded ? 'confirmed' : 'reverted')
    })
  }
  resolveConsumedNonce(attempt: StoredExecution, state: KeeperNonceObservation): void {
    if (state.nonce <= attempt.nonce) throw Error('No canonical evidence that keeper nonce was consumed')
    return this.driver.transaction(() => {
      this.driver.prepare('INSERT OR REPLACE INTO execution_resolutions(hash,observation_json,confirmed_nonce) VALUES(?,?,?)').run(attempt.hash, JSON.stringify(state.observation), state.nonce)
      // Keep the reserved maximum: the missing original receipt does not justify claiming an actual fee of zero.
      this.setExecutionCost(attempt, null, 'nonce_consumed')
    })
  }
}
