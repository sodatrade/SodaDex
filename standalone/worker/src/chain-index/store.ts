import type { Block, ChainLog, Pool } from '../dex-data'
import type { Batch, IndexConfig, IndexedEvent, IndexStatus, SavedCursor, SqlValue, Storage } from './types'
const json = <T>(value: SqlValue | undefined): T => JSON.parse(String(value)) as T
/** A checkpoint and its logs become durable in the same synchronous transaction. */
export class IndexStore {
  constructor(readonly storage: Storage, readonly config: IndexConfig) {
    this.query(`CREATE TABLE IF NOT EXISTS index_meta(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS index_ranges(first INTEGER PRIMARY KEY,last INTEGER NOT NULL,header TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS index_events(id TEXT PRIMARY KEY,block_number INTEGER NOT NULL,log_index INTEGER NOT NULL,address TEXT NOT NULL,event TEXT NOT NULL,sender TEXT NOT NULL,args TEXT NOT NULL,value TEXT NOT NULL,raw TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS index_event_order ON index_events(block_number DESC,log_index DESC);
      CREATE INDEX IF NOT EXISTS index_event_address ON index_events(address,block_number DESC);
      CREATE INDEX IF NOT EXISTS index_event_sender ON index_events(sender,block_number DESC);
      CREATE TABLE IF NOT EXISTS index_pools(id TEXT PRIMARY KEY,created_block INTEGER NOT NULL,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS index_cursors(id TEXT PRIMARY KEY,value TEXT NOT NULL,expires INTEGER NOT NULL);`)
    if (!this.query('SELECT id FROM index_meta').length) this.save({ schemaVersion: 1, profileId: config.profile.id, chainId: config.profile.chainId, deploymentVersion: config.version, head: null,
      indexedThrough: config.fromBlock - 1, fromBlock: config.fromBlock, syncing: true, lastError: null, generation: 0 })
    const status = this.status()
    if ((status.profileId ?? (status.chainId === 196 ? '196-test' : '1952-mining-test')) !== config.profile.id || status.chainId !== config.profile.chainId || status.deploymentVersion !== config.version) throw Error('Index identity mismatch')
  }
  query(sql: string, ...bindings: SqlValue[]): Record<string, SqlValue>[] { return this.storage.sql.exec(sql, ...bindings).toArray() }
  status(): IndexStatus { return json(this.query('SELECT value FROM index_meta WHERE id=1')[0]?.value) }
  save(status: IndexStatus): void { this.query('INSERT OR REPLACE INTO index_meta(id,value) VALUES(1,?)', JSON.stringify(status)) }
  anchor(): Block | null { return json(this.query('SELECT header FROM index_ranges ORDER BY last DESC LIMIT 1')[0]?.header ?? 'null') }
  fail(): void { this.save({ ...this.status(), lastError: 'Chain index temporarily unavailable', syncing: true }) }
  commit(batch: Batch): void {
    this.storage.transactionSync(() => {
      const state = this.status()
      if (batch.from !== state.indexedThrough + 1 || batch.to.number < batch.from) throw Error('Noncontiguous index interval')
      for (let i = 0; i < batch.events.length; i++) {
        const event = batch.events[i], raw = batch.logs[i], value = JSON.stringify(event)
        const old = this.query('SELECT value FROM index_events WHERE id=?', event.id)[0]
        if (old && old.value !== value) throw Error('Conflicting event identity')
        this.query('INSERT OR IGNORE INTO index_events VALUES(?,?,?,?,?,?,?,?,?)', event.id, event.blockNumber, event.logIndex, event.address.toLowerCase(), event.event, event.transactionFrom.toLowerCase(), JSON.stringify(event.args), value, JSON.stringify(raw))
      }
      for (const pool of batch.pools) this.query('INSERT OR REPLACE INTO index_pools VALUES(?,?,?)', pool.id.toLowerCase(), pool.createdBlock ?? this.config.fromBlock, JSON.stringify(pool))
      this.query('INSERT INTO index_ranges VALUES(?,?,?)', batch.from, batch.to.number, JSON.stringify(batch.to))
      this.save({ ...state, head: batch.head, indexedThrough: batch.to.number, syncing: batch.to.number < batch.head.number, lastError: null })
    })
  }
  rollback(): void {
    this.storage.transactionSync(() => {
      const last = this.query('SELECT first FROM index_ranges ORDER BY last DESC LIMIT 1')[0]
      if (!last) return
      const first = Number(last.first)
      this.query('DELETE FROM index_ranges WHERE first>=?', first)
      this.query('DELETE FROM index_events WHERE block_number>=?', first)
      this.query('DELETE FROM index_pools WHERE created_block>=?', first)
      this.query('DELETE FROM index_cursors')
      this.save({ ...this.status(), indexedThrough: first - 1, syncing: true, generation: this.status().generation + 1, lastError: 'Chain changed; index rebuilding' })
    })
  }
  restartSources(): void {
    this.storage.transactionSync(() => {
      this.query('DELETE FROM index_ranges'); this.query('DELETE FROM index_cursors'); this.query('DELETE FROM index_events'); this.query('DELETE FROM index_pools')
      this.save({ ...this.status(), indexedThrough: this.config.fromBlock - 1, syncing: true, generation: this.status().generation + 1 })
    })
  }
  pools(through: number): Pool[] { return this.query('SELECT value FROM index_pools WHERE created_block<=? ORDER BY created_block,id', through).map(row => json<Pool>(row.value)) }
  events(where: string, bindings: SqlValue[], offset: number): IndexedEvent[] {
    return this.query(`SELECT value FROM index_events WHERE ${where} ORDER BY block_number DESC,log_index DESC LIMIT 11 OFFSET ?`, ...bindings, offset).map(row => json<IndexedEvent>(row.value))
  }
  logs(addresses: string[], from: number, to: number): ChainLog[] {
    if (!addresses.length) return []
    return this.query(`SELECT raw FROM index_events WHERE block_number BETWEEN ? AND ? AND address IN (${addresses.map(() => '?').join(',')}) ORDER BY block_number,log_index`, from, to, ...addresses.map(a => a.toLowerCase())).map(row => json<ChainLog>(row.raw))
  }
  chartRows(pool: string, from: number, to: number): { log: ChainLog; block: Block }[] {
    const filter = pool.length === 42 ? 'address=?' : "lower(json_extract(args,'$.id'))=?"
    return this.query(`SELECT value,raw FROM index_events WHERE (event='Swap' OR (event='Sync' AND EXISTS (SELECT 1 FROM index_events AS swap WHERE swap.event='Swap' AND swap.address=index_events.address AND swap.block_number=index_events.block_number AND swap.log_index=index_events.log_index+1))) AND ${filter} AND block_number BETWEEN ? AND ? ORDER BY block_number,log_index LIMIT 10001`, pool.toLowerCase(), from, to).map(row => {
      const event = json<IndexedEvent>(row.value)
      return { log: json<ChainLog>(row.raw), block: { number: event.blockNumber, hash: event.blockHash, timestamp: event.timestamp } }
    })
  }
  cursor(id: string): SavedCursor | null { return json(this.query('SELECT value FROM index_cursors WHERE id=? AND expires>?', id, Date.now())[0]?.value ?? 'null') }
  saveCursor(cursor: SavedCursor): string {
    this.query('DELETE FROM index_cursors WHERE expires<=?', Date.now())
    const id = crypto.randomUUID(); this.query('INSERT INTO index_cursors VALUES(?,?,?)', id, JSON.stringify(cursor), cursor.expires); return id
  }
}
