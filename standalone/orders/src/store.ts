import { DatabaseSync } from 'node:sqlite'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { OrderRepository } from './repository.ts'
import type { SqlDriver, KeeperGuard } from './sql.ts'
export { NonceConflict, GasBudgetExceeded } from './repository.ts'
export type { StoredOrder, StoredExecution } from './repository.ts'
const APPLICATION_ID = 0x534f4441
class NodeDriver implements SqlDriver {
  readonly database: DatabaseSync
  constructor(database: DatabaseSync) { this.database = database }
  exec(query: string): void { this.database.exec(query) }
  prepare(query: string): ReturnType<SqlDriver['prepare']> { return this.database.prepare(query) }
  transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try { const result = operation(); this.database.exec('COMMIT'); return result }
    catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
}
class NodeKeeperGuard implements KeeperGuard {
  readonly driver: SqlDriver
  constructor(driver: SqlDriver) { this.driver = driver; driver.exec('CREATE TABLE IF NOT EXISTS keeper_guard(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,pid INTEGER NOT NULL)') }
  acquire(owner: string): boolean {
    return this.driver.transaction(() => {
      const guard = this.driver.prepare('SELECT * FROM keeper_guard WHERE id=1').get() as { owner: string; pid: number } | undefined
      let alive = false
      if (guard) { try { process.kill(guard.pid, 0); alive = true } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH' } }
      if (guard && alive) return false
      this.driver.prepare('INSERT OR REPLACE INTO keeper_guard(id,owner,pid) VALUES(1,?,?)').run(owner, process.pid)
      return true
    })
  }
  release(owner: string): void { this.driver.prepare('DELETE FROM keeper_guard WHERE id=1 AND owner=?').run(owner) }
}
export class OrderStore extends OrderRepository {
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
    if (application.application_id === APPLICATION_ID && ![1, 2].includes(version.user_version)) throw Error('Unsupported orders database version')
    const database = new DatabaseSync(path)
    database.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=2; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;`)
    const driver = new NodeDriver(database)
    super(driver, new NodeKeeperGuard(driver))
    this.database = database
  }
  close(): void { this.database.close() }
}
