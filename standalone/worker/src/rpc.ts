// The user-selected node rejects browser Origin headers. Only this server
// adapter knows the upstream; browsers always request the same-origin /api/rpc.
import { call } from './upstream'
export { RPC_URL } from './upstream'
import { contractReadKind } from './contract-reads'
import { deployment, FACTORY_READ, pools, record as isRecord, same, V3_POOL_READ } from './contracts'
import { validLogFilter } from './logs'
import { validLiquidityContext } from './lp-context'
import { validLiquidityRequest } from './lp-requests'
import { quoteRequest } from './quote-requests'
import { registeredPool } from './pool-registration'
import { validContractRequest } from './trade-requests'
import { tradeRoute } from './trade-routes'
import { networkProfile, type NetworkProfile } from '../../network-profile'
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const BLOCK = /^(latest|safe|finalized|pending|0x[0-9a-fA-F]+)$/
const EMPTY_METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_gasPrice'])
const MAX_BODY_BYTES = 16384

type RpcId = string | number
interface RpcRequest {
  jsonrpc: '2.0'
  id: RpcId
  method: string
  params: unknown[]
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validParams(method: string, params: unknown[], profile: NetworkProfile): boolean {
  if (EMPTY_METHODS.has(method)) return params.length === 0
  if (method === 'eth_getTransactionReceipt') return params.length === 1 && typeof params[0] === 'string' && /^0x[0-9a-fA-F]{64}$/.test(params[0])
  if (method === 'eth_getBlockByNumber') return params.length === 2 && typeof params[0] === 'string' && BLOCK.test(params[0]) && params[1] === false
  // No 1952 contract allowlist is deployed yet. Never validate its requests against 196 contracts.
  if (!profile.dexEnabled && !['eth_getBalance', 'eth_getCode'].includes(method)) return false
  if (method === 'eth_getLogs') return params.length === 1 && validLogFilter(params[0])
  if (method === 'eth_estimateGas') return params.length === 1 && validContractRequest(params[0], true)
  if (params.length !== 2 || typeof params[1] !== 'string' || !BLOCK.test(params[1])) return false
  if (method === 'eth_getBalance' || method === 'eth_getCode') {
    return typeof params[0] === 'string' && ADDRESS.test(params[0])
  }
  return method === 'eth_call' && validContractRequest(params[0], false)
}

function parseRequest(value: unknown, profile: NetworkProfile): RpcRequest | null {
  if (!record(value) || value.jsonrpc !== '2.0' || typeof value.method !== 'string' || !Array.isArray(value.params)) return null
  if (!(typeof value.id === 'number' && Number.isSafeInteger(value.id)) && !(typeof value.id === 'string' && value.id.length <= 64)) return null
  if (!validParams(value.method, value.params, profile)) return null
  return value as unknown as RpcRequest
}

export function rpcError(id: RpcId | null, code: number, message: string, status: number): Response {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}

export async function proxyRpc(request: Request, upstreamFetch: typeof fetch = fetch, profile: NetworkProfile = networkProfile()): Promise<Response> {
  if (request.method !== 'POST') return rpcError(null, -32600, 'POST required', 405)
  const origin = request.headers.get('Origin')
  if (origin && origin !== new URL(request.url).origin) return rpcError(null, -32600, 'Origin not allowed', 403)
  const expectedProfile = request.headers.get('X-SodaDEX-Network-Profile')
  if (expectedProfile && expectedProfile !== profile.id) return rpcError(null, -32600, 'Network profile mismatch', 409)
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return rpcError(null, -32600, 'JSON required', 415)
  }
  const length = Number(request.headers.get('Content-Length'))
  if (length > MAX_BODY_BYTES) return rpcError(null, -32600, 'Request too large', 413)
  // Bound bytes while streaming, including requests without Content-Length.
  const reader = request.body?.getReader()
  if (!reader) return rpcError(null, -32700, 'Invalid JSON', 400)
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      total += chunk.value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel()
        return rpcError(null, -32600, 'Request too large', 413)
      }
      chunks.push(chunk.value)
    }
  } catch {
    return rpcError(null, -32700, 'Unreadable request', 400)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let body: unknown
  try { body = JSON.parse(new TextDecoder().decode(bytes)) } catch { return rpcError(null, -32700, 'Invalid JSON', 400) }
  const rpc = parseRequest(body, profile)
  if (!rpc) return rpcError(null, -32600, 'Unsupported read request', 400)

  try {
    if (!profile.dexEnabled && rpc.method !== 'eth_chainId') {
      const chain = await upstreamFetch(profile.rpcUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'SodaDex/1.0' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'network-profile', method: 'eth_chainId', params: [] }),
        signal: AbortSignal.timeout(12_000), redirect: 'manual',
      })
      const identity: unknown = chain.ok ? await chain.json() : undefined
      if (!record(identity) || identity.jsonrpc !== '2.0' || identity.id !== 'network-profile' ||
        identity.result !== profile.chainHex || Object.hasOwn(identity, 'error'))
        return rpcError(rpc.id, -32000, 'RPC network mismatch', 502)
    }
    if ((rpc.method === 'eth_call' || rpc.method === 'eth_estimateGas') && isRecord(rpc.params[0])) {
      const tx = rpc.params[0]
      if (typeof tx.to === 'string' && same(tx.to, deployment.contracts.universalRouter) && typeof tx.data === 'string' && typeof tx.from === 'string') {
        const route = tradeRoute(tx.data as `0x${string}`, tx.from, BigInt(String(tx.value ?? '0x0')))
        if (route && !await registeredPool(route, 'trade', String(rpc.params[1] ?? 'latest'), upstreamFetch)) return rpcError(rpc.id, -32600, 'Pool is not registered or initialized', 400)
      }
    }
    if (rpc.method === 'eth_call' && isRecord(rpc.params[0]) && typeof rpc.params[0].to === 'string' && typeof rpc.params[0].data === 'string') {
      const quote = quoteRequest(rpc.params[0].to, rpc.params[0].data as `0x${string}`)
      if (quote && !await registeredPool(quote, 'quote', String(rpc.params[1]), upstreamFetch)) return rpcError(rpc.id, -32600, 'Pool is not registered or initialized', 400)
    }
    if ((rpc.method === 'eth_call' || rpc.method === 'eth_estimateGas') && isRecord(rpc.params[0])) {
      const tx = rpc.params[0]
      if (typeof tx.from === 'string' && typeof tx.to === 'string' && typeof tx.data === 'string' && validLiquidityRequest(tx.to, tx.data as `0x${string}`, tx.from, BigInt(String(tx.value ?? '0x0'))) &&
        !await validLiquidityContext(tx.to, tx.data as `0x${string}`, tx.from, BigInt(String(tx.value ?? '0x0')), String(rpc.params[1] ?? 'latest'), upstreamFetch)) return rpcError(rpc.id, -32600, 'LP ownership or currencies do not match', 400)
    }
    if (rpc.method === 'eth_call' && isRecord(rpc.params[0]) && typeof rpc.params[0].to === 'string' && typeof rpc.params[0].data === 'string' && contractReadKind(rpc.params[0].to, rpc.params[0].data as `0x${string}`) === 'pool') {
      if (!same(rpc.params[0].to, pools.v3.address)) {
        const [factory, token0, token1, fee] = await Promise.all(['factory', 'token0', 'token1', 'fee'].map((name) => call(V3_POOL_READ, String((rpc.params[0] as Record<string, unknown>).to), name, [], String(rpc.params[1]), upstreamFetch)))
        if (typeof factory !== 'string' || !same(factory, deployment.contracts.v3Factory)) return rpcError(rpc.id, -32600, 'Foreign pool', 400)
        const registered = await call(FACTORY_READ, deployment.contracts.v3Factory, 'getPool', [token0, token1, fee], String(rpc.params[1]), upstreamFetch)
        if (typeof registered !== 'string' || !same(registered, rpc.params[0].to)) return rpcError(rpc.id, -32600, 'Foreign pool', 400)
      }
    }
    const upstream = await upstreamFetch(profile.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'SodaDex/1.0' },
      body: JSON.stringify(rpc),
      signal: AbortSignal.timeout(12_000),
      // Workers supports manual/follow. A redirect is rejected by !upstream.ok.
      redirect: 'manual',
    })
    if (!upstream.ok) return rpcError(rpc.id, -32000, 'RPC temporarily unavailable', 502)
    const value: unknown = await upstream.json()
    if (!record(value) || value.jsonrpc !== '2.0' || value.id !== rpc.id) return rpcError(rpc.id, -32000, 'Invalid RPC response', 502)
    const hasResult = Object.hasOwn(value, 'result')
    const hasError = Object.hasOwn(value, 'error')
    if (hasResult === hasError || (hasError && (!record(value.error) ||
      typeof value.error.code !== 'number' || !Number.isInteger(value.error.code) ||
      typeof value.error.message !== 'string'))) return rpcError(rpc.id, -32000, 'Invalid RPC response', 502)
    if (rpc.method === 'eth_chainId' && hasResult && value.result !== profile.chainHex)
      return rpcError(rpc.id, -32000, 'RPC network mismatch', 502)
    return Response.json(value, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    console.warn('RPC transport failed:', error instanceof Error ? error.message : 'unknown error')
    return rpcError(rpc.id, -32000, 'RPC temporarily unavailable', 502)
  }
}
