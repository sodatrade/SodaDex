import { decodeFunctionData, encodeFunctionData, type Hex } from 'viem'
import { miningAbi, sameMiningAddress, validMiningProductCall, type MiningTransaction } from '../../../mining-calls'
import { normalizeMiningLaunchForm, type MiningLaunchForm } from '../../../mining-signed-calls'
import { parseMiningDeployment, type MiningAddress, type MiningProductDeployment, type MiningProject } from '../../../mining-products'

export type { MiningLaunchForm } from '../../../mining-signed-calls'
export interface MiningOnlineJob {
  id: string; kind: 'sync' | 'fund' | 'purchase' | 'conversion'; status: string; reason: string
  token?: MiningAddress; hash?: Hex; updatedAt: number
}
export interface MiningOnlineStatus {
  admissionEnabled: boolean; executionEnabled: boolean; signer: MiningAddress; keeper: MiningAddress | null; reason?: string
  budget: { capWei: string; spentWei: string; reservedWei: string }
  farm: { capacity: number; minerCount: number; procurementBudgetFab: string } | null
  jobs: MiningOnlineJob[]
}
export interface MiningOnlineCatalog { revision: string; deployment: MiningProductDeployment }
export interface MiningLaunchChallenge { requestId: string; message: string; expiresAt: number; form: MiningLaunchForm }
export interface MiningLaunchPreview { requestId: string; expiresAt: number; form: MiningLaunchForm; tx: MiningTransaction }
export interface MiningLaunchRegistration { project: MiningProject; revision: string }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const address = (v: unknown): v is MiningAddress => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/.test(v)
export const miningOnlineHash = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)
const uint = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < (1n << 256n)
const controls = (v: string): boolean => Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
const text = (v: unknown, max = 128): v is string => typeof v === 'string' && v.length <= max && !controls(v)
const invalid = (): never => { throw new Error('onlineInvalidResponse') }

/** Display-only fields; financial launch parameters remain fixed by the shared call validator. */
export function normalizeOnlineLaunchForm(value: MiningLaunchForm): MiningLaunchForm {
  try { return normalizeMiningLaunchForm(value) } catch { throw new Error('onlineInvalidForm') }
}
function parseForm(value: unknown): MiningLaunchForm {
  if (!record(value) || !text(value.name, 64) || !text(value.symbol, 25) || !text(value.metadataURI, 256)) return invalid()
  const form = { name: value.name, symbol: value.symbol, metadataURI: value.metadataURI }
  try { if (JSON.stringify(normalizeOnlineLaunchForm(form)) !== JSON.stringify(form)) return invalid() } catch { return invalid() }
  return form
}
export function launchAuthenticationMessage(d: MiningProductDeployment, from: MiningAddress, requestId: string,
  expiresAt: number, form: MiningLaunchForm, origin = location.origin): string {
  return [`SodaDEX 1952 test project launch`, `Origin: ${origin}`, 'Chain ID: 1952', `Deployment: ${d.version}`,
    `Address: ${from.toLowerCase()}`, `Request ID: ${requestId}`, `Expires at: ${expiresAt}`,
    `Name: ${form.name}`, `Symbol: ${form.symbol}`, `Metadata URI: ${form.metadataURI}`].join('\n')
}
function envelope(value: unknown, d: MiningProductDeployment): Record<string, unknown> {
  if (!record(value) || value.schemaVersion !== 1 || value.chainId !== 1952 || value.deploymentVersion !== d.version) return invalid()
  return value
}
async function request(d: MiningProductDeployment, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`/api/mining/${path}`, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      credentials: 'same-origin', signal: controller.signal,
      headers: { 'X-SodaDEX-Network-Profile': '1952-mining-test', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (!response.ok) throw new Error('onlineServiceUnavailable')
    return envelope(await response.json(), d)
  } catch (cause) {
    if (cause instanceof Error && ['onlineInvalidResponse', 'onlineServiceUnavailable'].includes(cause.message)) throw cause
    throw new Error('onlineServiceUnavailable')
  } finally { clearTimeout(timeout) }
}
export function parseOnlineCatalog(d: MiningProductDeployment, projects: unknown, revision: unknown): MiningOnlineCatalog {
  if (!Array.isArray(projects) || !text(revision) || !revision) return invalid()
  const merged = new Map(d.projects.map((p) => [p.token.address.toLowerCase(), p]))
  for (const candidate of projects) {
    if (!record(candidate) || !record(candidate.token) || !address(candidate.token.address)) return invalid()
    const previous = merged.get(candidate.token.address.toLowerCase())
    if (previous) {
      // A directory refresh may add a graduated pair; it cannot rebind an existing project.
      for (const role of ['token', 'vault', 'holder'] as const) {
        const identity = candidate[role]
        if (!record(identity) || typeof identity.address !== 'string' || typeof identity.runtimeKeccak256 !== 'string' ||
            !sameMiningAddress(identity.address, previous[role].address) || identity.runtimeKeccak256.toLowerCase() !== previous[role].runtimeKeccak256.toLowerCase()) return invalid()
      }
      if (candidate.symbol !== previous.symbol || (previous.pair && candidate.pair && (!record(candidate.pair) ||
          typeof candidate.pair.address !== 'string' || !sameMiningAddress(candidate.pair.address, previous.pair.address) ||
          typeof candidate.pair.runtimeKeccak256 !== 'string' || candidate.pair.runtimeKeccak256.toLowerCase() !== previous.pair.runtimeKeccak256.toLowerCase()))) return invalid()
    }
    const identity = (v: unknown): MiningProject['token'] => {
      if (!record(v) || !address(v.address) || !miningOnlineHash(v.runtimeKeccak256)) return invalid()
      return { address: v.address, runtimeKeccak256: v.runtimeKeccak256 }
    }
    if (typeof candidate.symbol !== 'string') return invalid()
    merged.set(candidate.token.address.toLowerCase(), { symbol: candidate.symbol, token: identity(candidate.token), vault: identity(candidate.vault),
      holder: identity(candidate.holder), ...(candidate.pair ? { pair: identity(candidate.pair) } : previous?.pair ? { pair: previous.pair } : {}) })
  }
  let parsed: ReturnType<typeof parseMiningDeployment>
  try { parsed = parseMiningDeployment({ ...d, projects: [...merged.values()] }) } catch { return invalid() }
  if (parsed.state !== 'ready') return invalid()
  return { revision, deployment: parsed }
}
export async function loadOnlineCatalog(d: MiningProductDeployment, token?: MiningAddress): Promise<MiningOnlineCatalog> {
  const r = await request(d, `projects${token ? `?token=${encodeURIComponent(token)}` : ''}`)
  return parseOnlineCatalog(d, r.projects, r.revision)
}
export async function loadOnlineStatus(d: MiningProductDeployment): Promise<MiningOnlineStatus> {
  const r = await request(d, 'status'), b = r.budget, farm = r.farm
  if (typeof r.admissionEnabled !== 'boolean' || typeof r.executionEnabled !== 'boolean' || !address(r.signer) ||
      (r.keeper !== null && !address(r.keeper)) || !record(b) || !uint(b.capWei) || !uint(b.spentWei) || !uint(b.reservedWei) ||
      BigInt(b.spentWei) + BigInt(b.reservedWei) > BigInt(b.capWei) || (r.reason !== undefined && !text(r.reason)) ||
      (farm !== null && (!record(farm) || !Number.isSafeInteger(farm.capacity) || Number(farm.capacity) < 0 ||
        !Number.isSafeInteger(farm.minerCount) || Number(farm.minerCount) < 0 || Number(farm.minerCount) > Number(farm.capacity) || !uint(farm.procurementBudgetFab))) || !Array.isArray(r.jobs)) return invalid()
  const jobs = r.jobs.map((j): MiningOnlineJob => {
    if (!record(j) || !text(j.id) || !j.id || !['sync', 'fund', 'purchase', 'conversion'].includes(String(j.kind)) ||
        !text(j.status, 64) || !text(j.reason, 300) || !Number.isSafeInteger(j.updatedAt) || Number(j.updatedAt) < 0 || Number(j.updatedAt) > 8_640_000_000_000_000 ||
        (j.token !== undefined && !address(j.token)) || (j.hash !== undefined && !miningOnlineHash(j.hash))) return invalid()
    return { id: j.id, kind: j.kind as MiningOnlineJob['kind'], status: j.status, reason: j.reason,
      updatedAt: Number(j.updatedAt), ...(j.token ? { token: j.token as MiningAddress } : {}), ...(j.hash ? { hash: j.hash as Hex } : {}) }
  })
  return { admissionEnabled: r.admissionEnabled, executionEnabled: r.executionEnabled, signer: r.signer, keeper: r.keeper as MiningAddress | null,
    budget: { capWei: b.capWei, spentWei: b.spentWei, reservedWei: b.reservedWei },
    farm: farm as MiningOnlineStatus['farm'], jobs, ...(typeof r.reason === 'string' ? { reason: r.reason } : {}) }
}
function authorization(r: Record<string, unknown>, expected: { requestId: string; form: MiningLaunchForm }): { expiresAt: number; form: MiningLaunchForm } {
  if (r.requestId !== expected.requestId || !Number.isSafeInteger(r.expiresAt)) return invalid()
  const expiresAt = Number(r.expiresAt), form = parseForm(r.form)
  if (expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('onlineExpired')
  if (JSON.stringify(form) !== JSON.stringify(expected.form)) return invalid()
  return { expiresAt, form }
}
export async function createLaunchChallenge(d: MiningProductDeployment, from: MiningAddress, requestId: string, form: MiningLaunchForm): Promise<MiningLaunchChallenge> {
  const r = await request(d, 'challenge', { address: from, action: 'launch', requestId, form }), parsed = authorization(r, { requestId, form })
  if (typeof r.message !== 'string' || r.message !== launchAuthenticationMessage(d, from, requestId, parsed.expiresAt, form)) return invalid()
  return { requestId, message: r.message, ...parsed }
}
export function validateOnlineLaunchTransaction(d: MiningProductDeployment, from: MiningAddress, form: MiningLaunchForm, value: unknown, expiresAt?: number): MiningTransaction {
  if (!record(value) || !validMiningProductCall(value, d, true) || typeof value.from !== 'string' ||
      !sameMiningAddress(value.from, from) || typeof value.to !== 'string' || !sameMiningAddress(value.to, d.contracts.manager.address) ||
      value.value !== '0x0' || typeof value.data !== 'string') return invalid()
  try {
    const abi = miningAbi('manager', 'write'), call = decodeFunctionData({ abi, data: value.data as Hex })
    if (call.functionName !== 'createToken' || !call.args?.length || !record(call.args[0]) ||
        call.args[0].name !== form.name || call.args[0].symbol !== form.symbol || call.args[0].metadataURI !== form.metadataURI ||
        (expiresAt !== undefined && call.args[3] !== BigInt(expiresAt)) ||
        encodeFunctionData({ abi, functionName: call.functionName, args: call.args }).toLowerCase() !== value.data.toLowerCase()) return invalid()
  } catch { return invalid() }
  return { from, to: d.contracts.manager.address, data: value.data as Hex, value: '0x0' }
}
export async function prepareOnlineLaunch(d: MiningProductDeployment, from: MiningAddress, challenge: MiningLaunchChallenge, signature: Hex): Promise<MiningLaunchPreview> {
  const r = await request(d, 'launch', { address: from, requestId: challenge.requestId, signature }), parsed = authorization(r, challenge)
  if (parsed.expiresAt > challenge.expiresAt) return invalid()
  return { requestId: challenge.requestId, ...parsed, tx: validateOnlineLaunchTransaction(d, from, parsed.form, r.tx, parsed.expiresAt) }
}
export async function registerOnlineLaunch(d: MiningProductDeployment, transactionHash: Hex): Promise<MiningLaunchRegistration> {
  const r = await request(d, 'register', { transactionHash }), catalog = parseOnlineCatalog(d, [r.project], r.revision)
  if (!record(r.project) || !record(r.project.token) || !address(r.project.token.address)) return invalid()
  const token = r.project.token.address
  const project = catalog.deployment.projects.find((p) => sameMiningAddress(p.token.address, token))
  if (!project) return invalid()
  return { project, revision: catalog.revision }
}
export async function requestOnlineCheck(d: MiningProductDeployment, token?: MiningAddress): Promise<{ queued: true; executionEnabled: boolean }> {
  const r = await request(d, 'run', token ? { token } : {})
  if (r.queued !== true || typeof r.executionEnabled !== 'boolean') return invalid()
  return { queued: true, executionEnabled: r.executionEnabled }
}
