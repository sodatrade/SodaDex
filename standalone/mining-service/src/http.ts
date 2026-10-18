import type { Address, Hex } from 'viem'
import { miningProfileId, type MiningProductDeployment } from '../../mining-products.ts'
import type { MiningLaunchForm } from '../../mining-signed-calls.ts'
import { normalizeMiningLaunchForm } from '../../mining-signed-calls.ts'
import { Admission } from './admission.ts'
import { Directory } from './directory.ts'
import { Repository } from './repository.ts'
import { frontendOriginAllowed } from './config.ts'
import { address, hash, record, ServiceError, type RuntimeConfig } from './types.ts'
export interface Application { config: RuntimeConfig; d: MiningProductDeployment; repo: Repository; admission: Admission; directory: Directory }
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const exact = (v: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(v).length === keys.length && keys.every(k => k in v)
function response(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
}
export function errorResponse(error: unknown, chainId: 1952 | 196 = 1952): Response {
  return response({ schemaVersion: 1, chainId, error: error instanceof ServiceError ? error.code : 'service_unavailable' }, error instanceof ServiceError ? error.status : 503)
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.split(';')[0].trim().match(/^application\/json$/i)) throw new ServiceError('json_required', 415)
  if (Number(request.headers.get('content-length') ?? 0) > 8192) throw new ServiceError('body_too_large', 413)
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []
  let size = 0
  if (reader) while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > 8192) { await reader.cancel(); throw new ServiceError('body_too_large', 413) }
    chunks.push(chunk.value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  let raw: string
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new ServiceError('invalid_json', 400) }
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new ServiceError('invalid_json', 400) }
  if (!record(value)) throw new ServiceError('invalid_request', 400)
  return value
}
export async function handleRequest(request: Request, app: Application): Promise<Response> {
  try {
    const { config: c, repo, d } = app, url = new URL(request.url)
    const origin = request.headers.get('Origin')
    if (!frontendOriginAllowed(c, origin) || request.headers.get('X-SodaDEX-Network-Profile') !== miningProfileId(d) || c.chainId !== d.chainId) throw new ServiceError('origin_denied', 403)
    const envelope = { schemaVersion: 1, profileId: miningProfileId(d), chainId: d.chainId, deploymentVersion: d.version }
    if (request.method === 'GET' && url.pathname === '/v1/status' && !url.search) {
      const s = repo.read()
      return response({ ...envelope, serviceBuild: 'online-mining-20261018-v10-isolated196', admissionEnabled: c.admissionEnabled, executionEnabled: c.executionEnabled,
        signer: c.expectedSigner, keeper: c.keeperAddress, budget: { capWei: String(c.gasCapWei), spentWei: s.spentWei, reservedWei: s.reservedWei },
        farm: s.farm ?? null, jobs: Object.values(s.jobs).toSorted((a, b) => b.updatedAt - a.updatedAt).slice(0, 50),
        ...(!c.policy ? { reason: 'policy_pending' } : {}) })
    }
    if (request.method === 'GET' && url.pathname === '/v1/projects') {
      if ([...url.searchParams.keys()].some(k => k !== 'token') || url.searchParams.getAll('token').length > 1) throw new ServiceError('invalid_request', 400)
      const token = url.searchParams.get('token')
      if (token !== null) { if (!address(token)) throw new ServiceError('invalid_request', 400); await app.directory.refresh(token) }
      const s = repo.read()
      return response({ ...envelope, revision: String(s.revision), projects: Object.values(s.projects) })
    }
    if (request.method !== 'POST' || url.search) throw new ServiceError('not_found', 404)
    const b = await body(request)
    if (url.pathname === '/v1/challenge') {
      if (!exact(b, ['address', 'action', 'requestId', 'form']) || !address(b.address) || b.action !== 'launch' || !uuid(b.requestId) ||
          !record(b.form) || !exact(b.form, ['name', 'symbol', 'metadataURI']) || ['name', 'symbol', 'metadataURI'].some(k => typeof (b.form as Record<string, unknown>)[k] !== 'string')) throw new ServiceError('invalid_request', 400)
      let form: MiningLaunchForm
      try { form = normalizeMiningLaunchForm(b.form as unknown as MiningLaunchForm) } catch { throw new ServiceError('invalid_launch_form', 400) }
      await app.admission.reconcileExpired()
      const challenge = app.admission.challenge(b.address, b.requestId, form, origin)
      await repo.flush()
      return response({ ...envelope, requestId: challenge.requestId, message: challenge.message, expiresAt: challenge.expiresAt, form: challenge.form })
    }
    if (url.pathname === '/v1/launch') {
      if (!exact(b, ['requestId', 'address', 'signature']) || !uuid(b.requestId) || !address(b.address) || typeof b.signature !== 'string' || !/^0x[0-9a-f]{130}$/i.test(b.signature)) throw new ServiceError('invalid_request', 400)
      return response({ ...envelope, ...await app.admission.launch(b.address, b.requestId, b.signature as Hex, origin) })
    }
    if (url.pathname === '/v1/register') {
      if (!exact(b, ['transactionHash']) || !hash(b.transactionHash)) throw new ServiceError('invalid_request', 400)
      return response({ ...envelope, ...await app.directory.register(b.transactionHash) })
    }
    if (url.pathname === '/v1/run') {
      if (Object.keys(b).some(k => k !== 'token') || b.token !== undefined && (!address(b.token) || !repo.read().projects[b.token.toLowerCase()])) throw new ServiceError('project_not_registered', 400)
      repo.change(s => {
        s.requested = true
        if (b.token) {
          const token = b.token as Address
          s.jobs[`project:${token.toLowerCase()}`] = { id: `project:${token.toLowerCase()}`, kind: 'sync', status: 'queued', reason: 'requested', token, updatedAt: Date.now() }
        }
      })
      await repo.flush()
      return response({ ...envelope, queued: true, executionEnabled: c.executionEnabled })
    }
    throw new ServiceError('not_found', 404)
  } catch (error) { return errorResponse(error, app.d.chainId) }
}
