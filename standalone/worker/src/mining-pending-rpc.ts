import type { NetworkProfile } from '../../network-profile'

interface RpcRequest { jsonrpc: '2.0'; id: string | number; method: string; params: unknown[] }
interface RpcReply { jsonrpc: '2.0'; id: number; result?: unknown; error?: unknown }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const quantity = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error('Invalid RPC quantity')
  return BigInt(value)
}
const fresh = (latest: unknown, pending: unknown): boolean => record(latest) && record(pending) &&
  quantity(pending.number) >= quantity(latest.number) && quantity(pending.timestamp) >= quantity(latest.timestamp)
const retryDelays = [1000, 2000, 4000, 4000, 4000] as const

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** The official 1952 RPC sometimes routes pending reads to an obsolete backend.
 * Batch freshness probes with the requested read; retry only stale/invalid reads.
 * The caller owns the public method/ABI allowlist and final reply validation.
 */
export async function readMiningPending(rpc: RpcRequest, profile: NetworkProfile, upstreamFetch: typeof fetch): Promise<unknown> {
  const tx = record(rpc.params[0]) ? rpc.params[0] : undefined
  const target = ['eth_call', 'eth_estimateGas'].includes(rpc.method) && typeof tx?.to === 'string' ? tx.to : undefined
  const sender = typeof tx?.from === 'string' ? tx.from : undefined
  const probes: [string, unknown[]][] = [
    ['eth_chainId', []], ['eth_getBlockByNumber', ['latest', false]], ['eth_getBlockByNumber', ['pending', false]],
  ]
  if (target) probes.push(['eth_getCode', [target, 'latest']], ['eth_getCode', [target, 'pending']])
  if (sender) probes.push(['eth_getTransactionCount', [sender, 'latest']], ['eth_getTransactionCount', [sender, 'pending']])
  const operations = [...probes, [rpc.method, rpc.params] as [string, unknown[]]]
  // A stale backend has persisted for 12 seconds in live 1952 observations.
  // Spread the six read attempts across 15 seconds, within one total deadline.
  const signal = AbortSignal.timeout(20_000)
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) await waitForRetry(retryDelays[attempt - 1], signal)
    signal.throwIfAborted()
    const response = await upstreamFetch(profile.rpcUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'SodaDex/1.0' },
      body: JSON.stringify(operations.map(([method, params], id) => ({ jsonrpc: '2.0', id, method, params }))),
      signal, redirect: 'manual',
    })
    if (!response.ok) throw new Error('Mining pending RPC unavailable')
    const body: unknown = await response.json()
    signal.throwIfAborted()
    if (!Array.isArray(body) || body.length !== operations.length || body.some((item: unknown) => !record(item) || item.jsonrpc !== '2.0' || !Number.isInteger(item.id))) continue
    const replies = new Map((body as RpcReply[]).map((item) => [item.id, item]))
    if (replies.size !== operations.length || operations.some((_, id) => !replies.has(id))) continue
    if (probes.some((_, id) => replies.get(id)?.error !== undefined)) continue
    const values = probes.map((_, id) => replies.get(id)?.result)
    if (values[0] !== profile.chainHex) throw new Error('Mining pending RPC network mismatch')
    try {
      if (!fresh(values[1], values[2])) continue
      if (target && (typeof values[3] !== 'string' || values[3] !== values[4])) continue
      if (sender && quantity(values.at(-1)) < quantity(values.at(-2))) continue
      const result = replies.get(probes.length)
      if (rpc.method === 'eth_getBlockByNumber' && result?.error === undefined && !fresh(values[1], result?.result)) continue
      // Preserve a fresh revert without retrying or hiding it.
      return { ...result, id: rpc.id }
    } catch { continue }
  }
  throw new Error('Mining pending RPC remained stale')
}
