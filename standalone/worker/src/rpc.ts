// The user-selected node rejects browser Origin headers. Only this server
// adapter knows the upstream; browsers always request the same-origin /api/rpc.
export const RPC_URL = 'https://rpc.ignix.bot/rpc/196'
const WOKB = '0xe538905cf8410324e03a5a23c1c177a474d59b2b'
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const BLOCK = /^(latest|safe|finalized|pending|0x[0-9a-fA-F]+)$/
const EMPTY_METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_gasPrice'])
const MAX_BODY_BYTES = 4096

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

function validParams(method: string, params: unknown[]): boolean {
  if (EMPTY_METHODS.has(method)) return params.length === 0
  if (params.length !== 2 || typeof params[1] !== 'string' || !BLOCK.test(params[1])) return false
  if (method === 'eth_getBalance' || method === 'eth_getCode') {
    return typeof params[0] === 'string' && ADDRESS.test(params[0])
  }
  if (method !== 'eth_call' || !record(params[0])) return false
  const call = params[0]
  if (Object.keys(call).some((key) => key !== 'to' && key !== 'data')) return false
  if (typeof call.to !== 'string' || call.to.toLowerCase() !== WOKB || typeof call.data !== 'string') return false
  // Only verified WOKB metadata and a single account balance may be read.
  return /^0x(313ce567|95d89b41|06fdde03)$/.test(call.data) ||
    /^0x70a082310{24}[0-9a-fA-F]{40}$/.test(call.data)
}

function parseRequest(value: unknown): RpcRequest | null {
  if (!record(value) || value.jsonrpc !== '2.0' || typeof value.method !== 'string' || !Array.isArray(value.params)) return null
  if (!(typeof value.id === 'number' && Number.isSafeInteger(value.id)) && !(typeof value.id === 'string' && value.id.length <= 64)) return null
  if (!validParams(value.method, value.params)) return null
  return value as unknown as RpcRequest
}

export function rpcError(id: RpcId | null, code: number, message: string, status: number): Response {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}

export async function proxyRpc(request: Request, upstreamFetch: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'POST') return rpcError(null, -32600, 'POST required', 405)
  const origin = request.headers.get('Origin')
  if (origin && origin !== new URL(request.url).origin) return rpcError(null, -32600, 'Origin not allowed', 403)
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
  const rpc = parseRequest(body)
  if (!rpc) return rpcError(null, -32600, 'Unsupported read request', 400)

  try {
    const upstream = await upstreamFetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'SodaDex/1.0' },
      body: JSON.stringify(rpc),
      signal: AbortSignal.timeout(12_000),
      redirect: 'error',
    })
    if (!upstream.ok) return rpcError(rpc.id, -32000, 'RPC temporarily unavailable', 502)
    const value: unknown = await upstream.json()
    if (!record(value) || value.jsonrpc !== '2.0' || value.id !== rpc.id) return rpcError(rpc.id, -32000, 'Invalid RPC response', 502)
    const hasResult = Object.hasOwn(value, 'result')
    const hasError = Object.hasOwn(value, 'error')
    if (hasResult === hasError || (hasError && (!record(value.error) ||
      typeof value.error.code !== 'number' || !Number.isInteger(value.error.code) ||
      typeof value.error.message !== 'string'))) return rpcError(rpc.id, -32000, 'Invalid RPC response', 502)
    return Response.json(value, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch {
    return rpcError(rpc.id, -32000, 'RPC temporarily unavailable', 502)
  }
}
