import { DurableObject } from 'cloudflare:workers'
import { createPublicClient, http } from 'viem'
import { FIXED } from '../src/config.ts'
import { ViemOrderChain } from '../src/chain.ts'
import { handleOrdersRequest, ordersError } from '../src/http.ts'
import { OrdersKeeper } from '../src/keeper.ts'
import { OrderRepository } from '../src/repository.ts'
import { OrdersService } from '../src/service.ts'
import { ActorKeeperGuard } from '../src/sql.ts'
import { actorName, cloudConfig } from './config.ts'
import type { ObjectState, OrdersEnv } from './runtime.ts'
import { DurableSqlDriver } from './sql.ts'
const MAX_RPC_PER_EVENT = 45
export class SodaOrders extends DurableObject {
  readonly #state: ObjectState; readonly #env: OrdersEnv; readonly #store: OrderRepository
  #tail: Promise<void> = Promise.resolve()
  constructor(state: ObjectState, env: OrdersEnv) {
    super(state, env)
    this.#state = state; this.#env = env
    this.#store = new OrderRepository(new DurableSqlDriver(state.storage), new ActorKeeperGuard())
  }
  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation)
    this.#tail = result.then(() => {}, () => {})
    return result
  }
  #application(): { service: OrdersService; keeper: OrdersKeeper; pollMs: number | null } {
    const { config, signer, pollMs } = cloudConfig(this.#env)
    let requests = 0
    const client = createPublicClient({ cacheTime: 0, transport: http(FIXED.rpcUrl, { retryCount: 0, timeout: 12_000, fetchOptions: { redirect: 'manual' }, fetchFn: async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== FIXED.rpcUrl || ++requests > MAX_RPC_PER_EVENT) throw Error('Orders RPC event budget exhausted')
      return fetch(input, init)
    } }) })
    const chain = new ViemOrderChain(config, client)
    return { service: new OrdersService(config, this.#store, chain, undefined, { maxListRefresh: 6 }), keeper: new OrdersKeeper(config, this.#store, chain, signer), pollMs }
  }
  async #schedule(pollMs: number | null, deployed: boolean): Promise<void> {
    if (!deployed || pollMs === null || !this.#store.hasWork()) { await this.#state.storage.deleteAlarm(); return }
    if (await this.#state.storage.getAlarm() === null) await this.#state.storage.setAlarm(Date.now() + pollMs)
  }
  fetch(request: Request): Promise<Response> {
    return this.#serial(async () => {
      try {
        const { service, pollMs } = this.#application()
        const response = await handleOrdersRequest(request, service)
        await this.#schedule(pollMs, service.config.settlement !== null)
        return response
      } catch (error) { return ordersError(error) }
    })
  }
  alarm(): Promise<void> {
    return this.#serial(async () => {
      const { service, keeper, pollMs } = this.#application()
      try { await keeper.runOnce({ maxOrders: 1, maxRecoveries: 1, stopAfterRecovery: true }) }
      catch { /* Preserve raw transactions and explicitly schedule remaining work after a temporary RPC outage. */ }
      finally { await this.#schedule(pollMs, service.config.settlement !== null) }
    })
  }
}
export default {
  async fetch(request: Request, env: OrdersEnv): Promise<Response> {
    try { return await env.ORDERS.get(env.ORDERS.idFromName(actorName())).fetch(request) }
    catch (error) { return ordersError(error) }
  },
}
