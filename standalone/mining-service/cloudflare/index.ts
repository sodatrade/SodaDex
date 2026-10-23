import { DurableObject } from 'cloudflare:workers'
import savedDeployment from '../../../deployments/xlayer-1952/products.json'
import { miningDeploymentForProfile, miningProfileId, parseMiningDeployment, type MiningProductDeployment } from '../../mining-products.ts'
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
const saved1952 = parseMiningDeployment(savedDeployment)
if (saved1952.state !== 'ready') throw new Error('Verified 1952 deployment required')
const defaultDeployment = saved1952
export const actorName = (deployment: MiningProductDeployment = defaultDeployment): string => `sodadex-mining:${deployment.chainId}:${deployment.version}`
function configuredDeployment(env: MiningEnv): MiningProductDeployment {
  const profile = env.MINING_NETWORK_PROFILE ?? '1952-mining-test'
  const deployment = miningDeploymentForProfile(profile, profile === '196-mining-test' && env.MINING_196_DEPLOYMENT ? JSON.parse(env.MINING_196_DEPLOYMENT) : undefined)
  if (deployment.state !== 'ready') throw new ServiceError('deployment_pending', 503)
  return deployment
}
export class SodaMining1952 extends DurableObject {
  readonly #repo: Repository
  readonly deployment: MiningProductDeployment
  #tail: Promise<void> = Promise.resolve()
  constructor(readonly state: ObjectState, readonly env: MiningEnv) {
    super(state, env);
    if (new.target === SodaMining1952 && env.MINING_NETWORK_PROFILE === '196-mining-test') throw new ServiceError('separate_namespace_required', 503)
    this.deployment = configuredDeployment(env)
    this.#repo = new Repository(new DurableStateStorage(state.storage), this.deployment)
  }
  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation)
    this.#tail = result.then(() => {}, () => {})
    return result
  }
  #application() {
    const { config, authorizer, keeper } = cloudConfig(this.env)
    const d = this.deployment
    if (config.chainId !== d.chainId || config.profileId !== miningProfileId(d)) throw new ServiceError('deployment_config_mismatch', 503)
    let requests = 0
    const rpc = new HttpRpc(config.rpcUrl, async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== config.rpcUrl || ++requests > 45) throw new ServiceError('rpc_event_budget', 503)
      return fetch(input, init)
    }, config.chainId)
    const planner = new Planner(config, d, this.#repo, rpc, discovery, authorizer)
    return { config, d, repo: this.#repo, admission: new Admission(config, d, this.#repo, rpc, discovery, authorizer),
      directory: new Directory(config, d, this.#repo, rpc, discovery), keeper: new Keeper(config, d, this.#repo, rpc, planner, keeper) }
  }
  async #schedule(enabled: boolean, pollMs: number | null): Promise<void> {
    if (!enabled || pollMs === null) { await this.state.storage.deleteAlarm(); return }
    if (await this.state.storage.getAlarm() === null) await this.state.storage.setAlarm(Date.now() + pollMs)
  }
  fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const retired = this.env.MINING_SERVICE_RETIRED === 'true'
    if (retired && !(request.method === 'GET' && !url.search && ['/v1/status', '/v1/projects'].includes(url.pathname)))
      return this.state.storage.deleteAlarm().then(() => errorResponse(new ServiceError('mining_service_retired', 410), this.deployment.chainId))
    const handle = async (): Promise<Response> => {
      try {
        const app = this.#application(), response = await handleRequest(request, app)
        await this.#schedule(app.config.executionEnabled, app.config.pollMs)
        if (retired && url.pathname === '/v1/status') return Response.json({ ...await response.json(), retired: true }, { status: response.status, headers: response.headers })
        return response
      } catch (e) { return errorResponse(e, this.deployment.chainId) }
    }
    // Directory/status are SQL snapshots and cannot wait behind RPC/signing/keeper activity.
    return request.method === 'GET' && (url.pathname === '/v1/status' || url.pathname === '/v1/projects' && !url.search) ? handle() : this.#serial(handle)
  }
  alarm(): Promise<void> {
    // Retirement must not touch signed transactions, reserves, or external RPCs.
    if (this.env.MINING_SERVICE_RETIRED === 'true') return this.state.storage.deleteAlarm()
    return this.#serial(async () => {
      const app = this.#application()
      try {
        await app.keeper.runOnce()
        if (this.#repo.read().jobs.service) {
          this.#repo.change(s => { delete s.jobs.service }); await this.#repo.flush()
        }
      }
      catch (e) {
        this.#repo.change(s => { s.jobs.service = { id: 'service', kind: 'sync', status: 'blocked',
          reason: e instanceof ServiceError ? e.code : 'service_unavailable', updatedAt: Date.now() } })
        await this.#repo.flush()
      } finally { await this.#schedule(app.config.executionEnabled, app.config.pollMs) }
    })
  }
}
/** Must use a new DO namespace; never rename or migrate the existing 1952 actor. */
export class SodaMining196Test extends SodaMining1952 {
  constructor(state: ObjectState, env: MiningEnv) {
    if (env.MINING_NETWORK_PROFILE !== '196-mining-test') throw new ServiceError('profile_required', 503)
    super(state, env)
  }
}
export default {
  async fetch(request: Request, env: MiningEnv): Promise<Response> {
    try {
      const deployment = configuredDeployment(env)
      const binding = deployment.chainId === 196 ? env.MINING_196 : env.MINING_1952
      if (!binding) throw new ServiceError('service_binding_missing', 503)
      return await binding.get(binding.idFromName(actorName(deployment))).fetch(request)
    } catch (e) { return errorResponse(e, env.MINING_NETWORK_PROFILE === '196-mining-test' ? 196 : 1952) }
  },
}
