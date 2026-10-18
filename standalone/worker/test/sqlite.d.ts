// Node 22 runtime API; repository-wide @types/node predates this built-in module.
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): { all(...values: (string | number | null)[]): Record<string, string | number | null>[] }
  }
}
