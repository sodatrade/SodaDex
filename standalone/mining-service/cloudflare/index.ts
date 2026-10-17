import { DurableObject } from 'cloudflare:workers'
import savedDeployment from '../../../deployments/xlayer-1952/products.json'
import { parseMiningDeployment } from '../../mining-products.ts'
import { Admission } from '../src/admission.ts'
import { Directory } from '../src/directory.ts'
import { Repository } from '../src/repository.ts'
import { Planner } from '../src/planner.ts'
import { Keeper } from '../src/keeper.ts'
import { handleRequest, errorResponse } from '../src/http.ts'
import { HttpRpc } from '../src/rpc.ts'
import { ServiceError } from '../src/types.ts'
import { cloudConfig } from './config.ts'
import { discovery } from './discovery-adapter.ts'
import { DurableStateStorage } from './sql.ts'
import type { MiningEnv, ObjectState } from './runtime.ts'
const deployment = parseMiningDeployment(savedDeployment)
if (deployment.state !== 'ready') throw new Error('Verified 1952 deployment required')
const d = deployment
export const actorName = (): string => `sodadex-mining:1952:${d.version}`
export class SodaMining1952 extends DurableObject {
  readonly #repo: Repository
  #tail: Promise<void> = Promise.resolve()
  constructor(readonly state: ObjectState, readonly env: MiningEnv) {
    super(state, env); this.#repo = new Repository(new DurableStateStorage(state.storage), d)
  }
  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation)
    this.#tail = result.then(() => {}, () => {})
    return result
  }
  #application() {
    const { config, authorizer, keeper } = cloudConfig(this.env)
    let requests = 0
    const rpc = new HttpRpc(config.rpcUrl, async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== config.rpcUrl || ++requests > 45) throw new ServiceError('rpc_event_budget', 503)
      return fetch(input, init)
    })
    const planner = new Planner(config, d, this.#repo, rpc, discovery, authorizer)
    return { config, d, repo: this.#repo, admission: new Admission(config, d, this.#repo, rpc, discovery, authorizer),
      directory: new Directory(config, d, this.#repo, rpc, discovery), keeper: new Keeper(config, d, this.#repo, rpc, planner, keeper) }
  }
  async #schedule(enabled: boolean, pollMs: number | null): Promise<void> {
    if (!enabled || pollMs === null) { await this.state.storage.deleteAlarm(); return }
    if (await this.state.storage.getAlarm() === null) await this.state.storage.setAlarm(Date.now() + pollMs)
  }
  fetch(request: Request): Promise<Response> {
    const handle = async (): Promise<Response> => {
      try {
        const app = this.#application(), response = await handleRequest(request, app)
        await this.#schedule(app.config.executionEnabled, app.config.pollMs); return response
      } catch (e) { return errorResponse(e) }
    }
    const url = new URL(request.url)
    // Directory/status are SQL snapshots and cannot wait behind RPC/signing/keeper activity.
    return request.method === 'GET' && (url.pathname === '/v1/status' || url.pathname === '/v1/projects' && !url.search) ? handle() : this.#serial(handle)
  }
  alarm(): Promise<void> {
    return this.#serial(async () => {
      const app = this.#application()
      try { await app.keeper.runOnce() }
      catch (e) {
        this.#repo.change(s => { s.jobs.service = { id: 'service', kind: 'sync', status: 'blocked',
          reason: e instanceof ServiceError ? e.code : 'service_unavailable', updatedAt: Date.now() } })
        await this.#repo.flush()
      } finally { await this.#schedule(app.config.executionEnabled, app.config.pollMs) }
    })
  }
}
export default {
  async fetch(request: Request, env: MiningEnv): Promise<Response> {
    try { return await env.MINING_1952.get(env.MINING_1952.idFromName(actorName())).fetch(request) }
    catch (e) { return errorResponse(e) }
  },
}
