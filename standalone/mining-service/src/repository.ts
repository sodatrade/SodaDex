import { miningProfileId, type MiningProductDeployment } from '../../mining-products.ts'
import { ServiceError, type PersistentState } from './types.ts'
export interface StateStorage {
  load(): string | undefined
  save(value: string): void
  transaction<T>(operation: () => T): T
  sync(): Promise<void>
}
/** One DO owns one 1952 deployment. Every mutation is durable before external effects. */
export class Repository {
  constructor(readonly storage: StateStorage, readonly deployment: MiningProductDeployment) {
    storage.transaction(() => {
      const saved = storage.load()
      if (saved) {
        const s = JSON.parse(saved) as PersistentState
        if (s.schema !== 1 || s.deploymentVersion !== deployment.version ||
            (s.profileId ?? '1952-mining-test') !== miningProfileId(deployment) || (s.chainId ?? 1952) !== deployment.chainId) throw new ServiceError('storage_deployment_mismatch', 503)
      } else storage.save(JSON.stringify({ schema: 1, profileId: miningProfileId(deployment), chainId: deployment.chainId, deploymentVersion: deployment.version, revision: 0,
        challenges: {}, projects: Object.fromEntries(deployment.projects.map(p => [p.token.address.toLowerCase(), p])),
        jobs: {}, executions: {}, spentWei: '0', reservedWei: '0', cursor: 0, requested: false, authorizations: {},
      } satisfies PersistentState))
    })
  }
  read(): PersistentState { return JSON.parse(this.storage.load() ?? '') as PersistentState }
  change<T>(operation: (state: PersistentState) => T): T {
    return this.storage.transaction(() => {
      const s = this.read(), value = operation(s)
      this.storage.save(JSON.stringify(s)); return value
    })
  }
  /** Reorg recovery restores every released slot before another network operation. */
  restoreExpiryReservations(): void {
    this.change(s => {
      for (const c of Object.values(s.challenges)) {
        if (c.status !== 'expired') continue
        if (!c.expiryProof) throw new ServiceError('expiry_proof_missing', 503)
        c.status = c.expiryProof.previousStatus
        delete c.expiryProof
      }
      s.admissionExpiry = { pending: true }
    })
  }
  async flush(): Promise<void> { await this.storage.sync() }
}
export class MemoryStorage implements StateStorage {
  value?: string
  load(): string | undefined { return this.value }
  save(value: string): void { this.value = value }
  transaction<T>(operation: () => T): T {
    const before = this.value
    try { return operation() } catch (e) { this.value = before; throw e }
  }
  async sync(): Promise<void> { /* In-memory fixtures have no asynchronous writes. */ }
}
