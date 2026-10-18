import { decodeFunctionResult, encodeFunctionData, parseAbi, type Abi, type Address, type Hex } from 'viem'
import { ServiceError, quantity, record, type Block, type Rpc } from './types.ts'
import { freshPending, type BatchRpc } from './pending-rpc.ts'
interface Queued { method: string; params: unknown[]; resolve(value: unknown): void; reject(error: unknown): void }
export class HttpRpc implements BatchRpc {
  #id = 0
  #queue: Queued[] = []
  #scheduled = false
  constructor(readonly url: string, readonly fetcher: typeof fetch = fetch, readonly chainId: 1952 | 196 = 1952) {}
  async batch(operations: readonly { method: string; params: unknown[] }[]): Promise<unknown[]> {
    const calls = operations.map(o => ({ jsonrpc: '2.0', id: ++this.#id, ...o }))
    const result = await this.fetcher(this.url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(calls), signal: AbortSignal.timeout(20_000), redirect: 'manual' })
    if (!result.ok) throw new ServiceError('rpc_unavailable', 503)
    const body: unknown = await result.json()
    if (!Array.isArray(body) || body.length !== calls.length) throw new ServiceError('rpc_invalid', 503)
    return calls.map(call => {
      const values = body.filter(v => record(v) && v.id === call.id)
      if (values.length !== 1 || !record(values[0])) throw new ServiceError('rpc_invalid', 503)
      const value = values[0]
      if (value.error) return { rpcError: true }
      if (!('result' in value)) throw new ServiceError('rpc_invalid', 503)
      return value.result
    })
  }
  request(method: string, params: unknown[] = []): Promise<unknown> {
    if (['eth_call', 'eth_estimateGas'].includes(method) && params[1] === 'pending') return freshPending(this, method, params, undefined, this.chainId)
    if (method === 'eth_sendRawTransaction') return this.batch([{ method, params }]).then(v => {
      if (record(v[0]) && v[0].rpcError) throw new ServiceError('broadcast_unknown', 503)
      return v[0]
    })
    return new Promise((resolve, reject) => {
      this.#queue.push({ method, params, resolve, reject })
      if (!this.#scheduled) { this.#scheduled = true; queueMicrotask(() => { void this.#flush() }) }
    })
  }
  async #flush(): Promise<void> {
    this.#scheduled = false
    const batch = this.#queue.splice(0, 10)
    if (this.#queue.length) { this.#scheduled = true; queueMicrotask(() => { void this.#flush() }) }
    try {
      const result = await this.batch(batch)
      batch.forEach((call, i) => {
        if (record(result[i]) && result[i].rpcError) call.reject(new ServiceError('rpc_call_failed', 503))
        else call.resolve(result[i])
      })
    } catch (e) { batch.forEach(call => call.reject(e)) }
  }
}
export async function read<T>(rpc: Rpc, to: Address, signature: string, args: readonly unknown[] = [], tag = 'latest'): Promise<T> {
  const abi: Abi = parseAbi([signature]), item = abi[0]
  if (!item || item.type !== 'function') throw new Error('Function ABI required')
  const data = encodeFunctionData({ abi, functionName: item.name, args })
  const result = await rpc.request('eth_call', [{ to, data }, tag])
  if (typeof result !== 'string' || !/^0x[0-9a-f]*$/i.test(result)) throw new ServiceError('rpc_invalid', 503)
  return decodeFunctionResult({ abi, functionName: item.name, data: result as Hex }) as T
}
export async function block(rpc: Rpc, tag = 'latest'): Promise<Block> {
  const b = await rpc.request('eth_getBlockByNumber', [tag, false])
  if (!record(b) || typeof b.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(b.hash)) throw new ServiceError('rpc_invalid', 503)
  if (/^0x[0-9a-f]+$/i.test(tag) && quantity(b.number) !== quantity(tag)) throw new ServiceError('rpc_height_mismatch', 503)
  return { number: `0x${quantity(b.number).toString(16)}`, hash: b.hash as Hex, timestamp: quantity(b.timestamp) }
}
export async function assertCanonical(rpc: Rpc, b: Block): Promise<void> {
  if ((await block(rpc, b.number)).hash.toLowerCase() !== b.hash.toLowerCase()) throw new ServiceError('chain_reorg', 503)
}
