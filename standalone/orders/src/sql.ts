export type SqlValue = string | number | null
export interface SqlStatement {
  get(...bindings: SqlValue[]): unknown
  all(...bindings: SqlValue[]): unknown[]
  run(...bindings: SqlValue[]): { changes: number | bigint }
}
export interface SqlDriver {
  exec(query: string): void
  prepare(query: string): SqlStatement
  transaction<T>(operation: () => T): T
  sync?(): Promise<void>
}
export interface KeeperGuard { acquire(owner: string): boolean; release(owner: string): void }
export class ActorKeeperGuard implements KeeperGuard {
  private owner: string | null = null
  acquire(owner: string): boolean { if (this.owner !== null) return false; this.owner = owner; return true }
  release(owner: string): void { if (this.owner === owner) this.owner = null }
}
