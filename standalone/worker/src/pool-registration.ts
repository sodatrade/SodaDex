import { deployment, FACTORY_READ, same, STATE_READ, V3_POOL_READ, ZERO, type PoolReference } from './contracts'
import { poolId } from './dex-data'
import { call } from './upstream'

/** Fixed deployment adapters establish registration; a trade also requires initialized V3 state. */
export async function registeredPool(request: PoolReference, purpose: 'quote' | 'trade', block: string, upstreamFetch: typeof fetch): Promise<boolean> {
  if (request.protocol === 'v3') {
    const pool = await call(FACTORY_READ, deployment.contracts.v3Factory, 'getPool', [request.tokenIn, request.tokenOut, request.fee], block, upstreamFetch)
    if (typeof pool !== 'string' || same(pool, ZERO)) return false
    if (purpose === 'quote') return true
    const slot = await call(V3_POOL_READ, pool, 'slot0', [], block, upstreamFetch)
    return Array.isArray(slot) && typeof slot[0] === 'bigint' && slot[0] > 0n
  }
  const key = request.key
  const id = poolId(key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks)
  const slot = await call(STATE_READ, deployment.contracts.v4StateView, 'getSlot0', [id], block, upstreamFetch)
  return Array.isArray(slot) && typeof slot[0] === 'bigint' && slot[0] > 0n
}
