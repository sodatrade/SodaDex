import type { SqlDriver, SqlStatement, SqlValue } from '../src/sql.ts'
import type { ObjectStorage } from './runtime.ts'
/** Cursors never escape this adapter or cross an await. DO transactions never execute SQL BEGIN. */
export class DurableSqlDriver implements SqlDriver {
  readonly storage: ObjectStorage
  constructor(storage: ObjectStorage) { this.storage = storage }
  exec(query: string): void { this.storage.sql.exec(query).toArray() }
  prepare(query: string): SqlStatement {
    const all = (...bindings: SqlValue[]): Record<string, SqlValue>[] => this.storage.sql.exec(query, ...bindings).toArray()
    return { all, get: (...bindings) => all(...bindings)[0], run: (...bindings) => { all(...bindings); return { changes: Number(this.storage.sql.exec('SELECT changes() AS changes').toArray()[0].changes) } } }
  }
  transaction<T>(operation: () => T): T { return this.storage.transactionSync(operation) }
  sync(): Promise<void> { return this.storage.sync() }
}
