import { ServiceError, quantity, record, type Rpc } from './types.ts'
interface Operation { method: string; params: unknown[] }
export interface BatchRpc extends Rpc { batch(operations: readonly Operation[]): Promise<unknown[]> }
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
/** Same upstream batch proves pending reads are not served by the known stale 1952 backend. */
export async function freshPending(rpc: BatchRpc, method: string, params: unknown[], wait = delay): Promise<unknown> {
  const tx = record(params[0]) ? params[0] : undefined
  const probes: Operation[] = [{ method: 'eth_chainId', params: [] }, { method: 'eth_getBlockByNumber', params: ['latest', false] },
    { method: 'eth_getBlockByNumber', params: ['pending', false] }]
  if (typeof tx?.to === 'string') probes.push({ method: 'eth_getCode', params: [tx.to, 'latest'] }, { method: 'eth_getCode', params: [tx.to, 'pending'] })
  if (typeof tx?.from === 'string') probes.push({ method: 'eth_getTransactionCount', params: [tx.from, 'latest'] }, { method: 'eth_getTransactionCount', params: [tx.from, 'pending'] })
  const delays = [1000, 2000, 4000, 4000, 4000]
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt) await wait(delays[attempt - 1])
    const result = await rpc.batch([...probes, { method, params }])
    const [chain, latest, pending] = result
    let fresh = false
    try {
      fresh = quantity(chain) === 1952n && record(latest) && record(pending) && quantity(pending.number) >= quantity(latest.number) && quantity(pending.timestamp) >= quantity(latest.timestamp)
      let i = 3
      if (typeof tx?.to === 'string') { fresh = fresh && typeof result[i] === 'string' && result[i] !== '0x' && result[i] === result[i + 1]; i += 2 }
      if (typeof tx?.from === 'string') fresh = fresh && quantity(result[i + 1]) >= quantity(result[i])
    } catch { fresh = false }
    if (!fresh) continue
    const value = result[result.length - 1]
    if (record(value) && value.rpcError === true) throw new ServiceError('simulation_reverted', 422)
    return value
  }
  throw new ServiceError('pending_rpc_stale', 503)
}
