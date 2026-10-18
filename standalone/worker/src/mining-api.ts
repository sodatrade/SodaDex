import type { NetworkProfile } from '../../network-profile'
import { MINING_PRODUCTS, parseMiningDeployment, type MiningDeploymentState } from '../../mining-products'

export interface MiningApiBinding { fetch(request: Request): Promise<Response> }
const paths: Readonly<Record<string, 'GET' | 'POST'>> = { status: 'GET', projects: 'GET', challenge: 'POST', launch: 'POST', register: 'POST', run: 'POST' }
const failure = (status: number, reason: string): Response => Response.json({ error: reason, reason, chainId: 1952 }, { status, headers: { 'Cache-Control': 'no-store' } })
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const privateKeys = new Set(['privatekey', 'private_key', 'password', 'keystore', 'raw', 'rawtransaction', 'raw_transaction', 'walletsignature', 'authsignature', 'signature'])
function containsPrivate(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPrivate)
  return record(value) && Object.entries(value).some(([key, item]) => privateKeys.has(key.toLowerCase()) || containsPrivate(item))
}
function internal(path: string, origin: string, init?: RequestInit): Request {
  return new Request(`https://mining.internal/v1/${path}`, { ...init,
    headers: { 'Content-Type': 'application/json', 'Origin': origin, 'X-SodaDEX-Network-Profile': '1952-mining-test' } })
}
async function boundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('invalid_json')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > 16_384) { await reader.cancel(); throw new Error('request_too_large') }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

/** A fixed private Service Binding, scoped to the 1952 UI. No client-selected upstream. */
export async function miningApi(request: Request, binding: MiningApiBinding | undefined, profile: NetworkProfile): Promise<Response> {
  if (profile.chainId !== 1952) return failure(503, 'mining_network_unavailable')
  if (!binding || MINING_PRODUCTS.state !== 'ready') return failure(503, 'mining_service_unavailable')
  const url = new URL(request.url), path = url.pathname.slice('/api/mining/'.length)
  if (!Object.hasOwn(paths, path)) return failure(404, 'not_found')
  if (request.method !== paths[path]) return failure(405, 'method_not_allowed')
  if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return failure(403, 'origin_not_allowed')
  const expected = request.headers.get('X-SodaDEX-Network-Profile')
  if (expected && expected !== profile.id) return failure(409, 'network_profile_mismatch')
  if ([...url.searchParams.keys()].some((key) => path !== 'projects' || key !== 'token') ||
      (url.searchParams.has('token') && !/^0x[0-9a-fA-F]{40}$/.test(url.searchParams.get('token')!))) return failure(400, 'invalid_query')
  let body: string | undefined
  if (request.method === 'POST') {
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return failure(415, 'json_required')
    try {
      const value = await boundedJson(request)
      if (!record(value)) return failure(400, 'invalid_request')
      body = JSON.stringify(value)
    } catch (error) { return failure(error instanceof Error && error.message === 'request_too_large' ? 413 : 400, 'invalid_request') }
  }
  try {
    const response = await binding.fetch(internal(`${path}${url.search}`, url.origin, { method: request.method, body }))
    const value: unknown = await response.json()
    if (!record(value) || containsPrivate(value) || value.chainId !== 1952) return failure(503, 'mining_service_unavailable')
    if (response.status === 503 && ['challenge', 'launch'].includes(path) && value.schemaVersion === 1 && value.error === 'expiry_reconciliation_pending') {
      // Forward only this fixed retry state, never private backend diagnostics.
      return Response.json({ schemaVersion: 1, chainId: 1952, error: 'expiry_reconciliation_pending' },
        { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
    }
    if (response.status >= 500) return failure(503, 'mining_service_unavailable')
    if (response.ok && (value.schemaVersion !== 1 || value.deploymentVersion !== MINING_PRODUCTS.version)) return failure(502, 'mining_service_version_mismatch')
    return Response.json(value, { status: response.status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch { return failure(503, 'mining_service_unavailable') }
}

/** Only service-proven projects extend the request allowlist. Base roots stay immutable. */
export async function miningCatalog(binding: MiningApiBinding | undefined, origin: string): Promise<MiningDeploymentState> {
  if (!binding || MINING_PRODUCTS.state !== 'ready') return MINING_PRODUCTS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // Directory reads are SQL-only. An unavailable new service must not stall
    // reads of the already pinned projects or silently trust an unknown target.
    const response = await Promise.race([binding.fetch(internal('projects', origin)),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('catalog_timeout')), 1500) })])
    const value: unknown = await response.json()
    if (!response.ok || !record(value) || containsPrivate(value) || value.chainId !== 1952 || value.schemaVersion !== 1 ||
        value.deploymentVersion !== MINING_PRODUCTS.version || !Array.isArray(value.projects)) return MINING_PRODUCTS
    const merged = new Map(MINING_PRODUCTS.projects.map((p) => [p.token.address.toLowerCase(), p]))
    for (const item of value.projects) {
      // Full structural validation precedes any access to a new identity.
      const parsed = parseMiningDeployment({ ...MINING_PRODUCTS, projects: [item] })
      if (parsed.state !== 'ready') return MINING_PRODUCTS
      merged.set(parsed.projects[0].token.address.toLowerCase(), parsed.projects[0])
    }
    return parseMiningDeployment({ ...MINING_PRODUCTS, projects: [...merged.values()] })
  } catch { return MINING_PRODUCTS }
  finally { clearTimeout(timer) }
}
