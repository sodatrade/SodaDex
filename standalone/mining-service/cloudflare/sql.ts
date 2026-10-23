import type { StateStorage } from '../src/repository.ts'
import type { SqlStorage } from './runtime.ts'
export class DurableStateStorage implements StateStorage {
  constructor(readonly storage: SqlStorage) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS mining_1952_state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)').toArray()
  }
  load(): string | undefined {
    const row = this.storage.sql.exec('SELECT value FROM mining_1952_state WHERE id=1').toArray()[0]
    return row ? String(row.value) : undefined
  }
  save(value: string): void {
    this.storage.sql.exec('INSERT INTO mining_1952_state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', value).toArray()
  }
  transaction<T>(operation: () => T): T { return this.storage.transactionSync(operation) }
  sync(): Promise<void> { return this.storage.sync() }
}
