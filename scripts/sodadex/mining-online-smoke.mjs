#!/usr/bin/env node
// Bounded public TEST-ONLINE acceptance. Default CLI never reads a key or sends a transaction.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { decodeEventLog, parseAbi } from 'viem'
import { build } from 'esbuild'
import { OnlineAssetRpc } from './mining-online-assets-public.mjs'
import { ONLINE_OWNER, same, json, assertMiningFeeParameters } from './mining-online-assets.mjs'
import { validateSignedMiningTransaction } from './mining-public-execution.mjs'
import { MINING_PUBLIC_RPC } from './mining-public-rpc.mjs'
import { fileSha } from './mining-plan-artifacts.mjs'
const KEEPER = '0x553D8C2e637fe67C5c7AdE3810E8Bc02799D41D4'
const S = '0x5DeAca6ecc97b07cA95D700f2BB26e4466774Ab6'
const ORIGIN = 'https://sodadex-mining-test-1952.jsmsdx2025.workers.dev'
const GAS_CAP = 500_000_000_000_000n, FAB_CAP = 1_500_000_000_000n, PRICE_CAP = 30_000_000n
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
export function assertSmokeRegistration(receipt, d, project) {
  const abi = parseAbi(['event TokenCreated(address indexed token,address indexed creator,address indexed quote,uint256 graduation,string metadataURI,address vault,address tracker,uint16 templateId)'])
  const matches = receipt.logs.filter(log => same(log.address, d.contracts.manager.address)).flatMap(log => {
    try { return [decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true }).args] } catch { return [] }
  })
  if (matches.length !== 1) throw new Error('One canonical Manager creation event required')
  const e = matches[0]
  if (!same(e.creator, ONLINE_OWNER) || !same(e.quote, d.contracts.fab.address) || e.templateId !== d.templateId ||
      e.graduation !== 500000000000n || e.metadataURI !== '' || project.symbol !== 'TEST-ONLINE' ||
      !same(e.token, project.token.address) || !same(e.vault, project.vault.address) || !same(e.tracker, project.holder.address)) throw new Error('Registration differs from exact owner launch')
}
export function validateSmokeApproval(p, assets) {
  const b = p.proposedBudget
  if (p.approved !== true || p.phase !== 'mining-online-assets-1952-v1' || p.chainId !== 1952 || p.stage !== 'test' ||
      !same(p.owner, ONLINE_OWNER) || !same(p.keeper, KEEPER) || !same(p.authorizer, S) || p.publicOrigin !== ORIGIN ||
      !p.approvalReference || b?.ownerGasCapWei !== String(GAS_CAP) || b.keeperGasCapWei !== String(GAS_CAP) ||
      b.totalGasCapWei !== '1000000000000000' || b.nativePrincipalCapWei !== '1000000000000000' || b.fabPrincipalCapRaw !== String(FAB_CAP) ||
      b.keeperFundingWei !== String(GAS_CAP) || p.proposedOperatingPolicy?.slippageBps !== 50 ||
      BigInt(p.assets?.liquidityNativeWei ?? -1) < 0n || BigInt(p.assets.liquidityNativeWei) > 1000000000000000n) throw new Error('Exact approved 1952 online phase required')
  if (!assets.publicTestnet || assets.chainId !== 1952 || !same(assets.owner, ONLINE_OWNER) || assets.planSha256 !== p.assets.planSha256 ||
      assets.pending || assets.transactions?.length !== 14 || assets.transactions.some(r => r.status !== '0x1') ||
      assets.startNonce !== p.assets.expectedOwnerNonce || BigInt(assets.actualFeesWei) > GAS_CAP || p.assets.liquidityFabRaw !== '900000000000') throw new Error('Completed canonical 14-transaction asset journal required')
}
export function savePrivate(file, value) {
  const tmp = `${file}.tmp`, fd = fs.openSync(tmp, 'w', 0o600)
  try { fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, json(value) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, file)
}
export async function loadSmokeModules(root, folder) {
  fs.mkdirSync(folder, { recursive: true })
  const source = ["export {buildMiningPlan,simpleMiningPlan} from './standalone/web/src/mining/plans.ts'",
    "export {createLaunchChallenge,prepareOnlineLaunch,registerOnlineLaunch,loadOnlineStatus,requestOnlineCheck} from './standalone/web/src/mining/onlineApi.ts'",
    "export {verifyMiningBase,resolveMiningProject,miningDiscoveryRead} from './standalone/mining-discovery.ts'",
    "export {validMiningProductCall} from './standalone/mining-calls.ts'",
    "export {parseMiningDeployment} from './standalone/mining-products.ts'"].join('\n')
  const result = await build({ stdin: { contents: source, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false, logLevel: 'silent' })
  const file = path.join(folder, 'smoke-protocol.mjs'); fs.writeFileSync(file, result.outputFiles[0].contents, { mode: 0o600 })
  return import(pathToFileURL(file).href)
}
export class SmokeSender {
  constructor({ rpc, modules, deployment, approval, assets, output, sign, validateSigned = validateSignedMiningTransaction, now = Date.now, pause = wait }) {
    Object.assign(this, { rpc, m: modules, d: deployment, approval, assets, output, sign, validateSigned, now, pause })
    this.state = { schemaVersion: 1, phase: approval.phase, chainId: 1952, owner: ONLINE_OWNER, approvalSha256: fileSha(json(approval)),
      assetPlanSha256: assets.planSha256, actualOwnerFeesWei: assets.actualFeesWei, fabInputRaw: approval.assets.liquidityFabRaw, transactions: [], pending: null }
  }
  save() {
    this.state.reservedGasWei = this.state.pending ? String(BigInt(this.state.pending.gas) * BigInt(this.state.pending.price)) : '0'
    savePrivate(this.output, this.state)
  }
  async verify() {
    const base = { ...this.d, projects: this.d.projects.filter(p => !this.project || !same(p.token.address, this.project.token.address)) }
    const block = await this.m.verifyMiningBase(this.rpc, base, S)
    if (this.project) {
      this.project = await this.m.resolveMiningProject(this.rpc, base, this.project.token.address, S, block)
      this.d = { ...base, projects: [...base.projects, this.project] }
    }
    return block
  }
  async start() {
    validateSmokeApproval(this.approval, this.assets)
    if (fs.existsSync(this.output)) throw new Error('Smoke journal exists; reconcile-only, never rerun')
    if (await this.rpc.request('eth_chainId') !== '0x7a0') throw new Error('1952 only')
    let fees = 0n
    for (const row of this.assets.transactions) {
      const r = await this.rpc.request('eth_getTransactionReceipt', [row.hash])
      if (!r || r.status !== '0x1' || !same(r.from, ONLINE_OWNER) || r.blockHash !== row.receipt.blockHash) throw new Error('Asset receipt changed')
      const b = await this.rpc.request('eth_getBlockByNumber', [r.blockNumber, false])
      if (b.number !== r.blockNumber || b.hash !== r.blockHash) throw new Error('Asset receipt reorg')
      fees += BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice)
      this.assetAnchor = { number: b.number, hash: b.hash }
    }
    if (fees !== BigInt(this.assets.actualFeesWei)) throw new Error('Asset actual cost mismatch')
    const nonce = await this.nonce()
    if (nonce !== BigInt(this.assets.startNonce) + 14n) throw new Error('Post-assets owner nonce changed')
    this.state.startNonce = String(nonce); await this.verify()
    fs.closeSync(fs.openSync(this.output, 'wx', 0o600)); this.save()
  }
  async nonce() {
    const latest = BigInt(await this.rpc.request('eth_getTransactionCount', [ONLINE_OWNER, 'latest']))
    if (BigInt(await this.rpc.request('eth_getTransactionCount', [ONLINE_OWNER, 'pending'])) !== latest) throw new Error('Owner nonce unresolved')
    return latest
  }
  async fees(bytes, gas, block) {
    await assertMiningFeeParameters({ call: (to, sig, args) => this.m.miningDiscoveryRead(this.rpc, to, sig, args, block ?? 'latest') }, bytes, gas)
  }
  async send(label, tx) {
    if (this.state.pending) throw new Error('Pending original hash must be reconciled')
    await this.verify()
    if (!this.m.validMiningProductCall(tx, this.d, true) || !same(tx.from, ONLINE_OWNER) || tx.value !== '0x0') throw new Error('Invalid exact canonical test call')
    const anchor = this.state.transactions.at(-1)?.receipt ?? this.assetAnchor
    const block = await this.rpc.request('eth_getBlockByNumber', [anchor.blockNumber ?? anchor.number, false])
    if (block.hash !== (anchor.blockHash ?? anchor.hash)) throw new Error('Earlier receipt changed; all costs require reconciliation')
    const nonce = await this.nonce()
    if (nonce !== BigInt(this.state.startNonce) + BigInt(this.state.transactions.length)) throw new Error('Smoke nonce drift')
    await this.rpc.request('eth_call', [tx, 'pending'])
    const gas = (BigInt(await this.rpc.request('eth_estimateGas', [tx, 'pending'])) * 120n + 99n) / 100n
    const price = BigInt(await this.rpc.request('eth_gasPrice'))
    if (price <= 0n || price > PRICE_CAP || BigInt(this.state.actualOwnerFeesWei) + gas * price > GAS_CAP) throw new Error('Owner cumulative gas cap or price exceeded')
    await this.fees(BigInt(tx.data.length / 2 + 256), gas)
    const intent = { nonce, gas, gasPrice: price, to: tx.to, data: tx.data, value: 0n }
    const raw = await this.sign(intent)
    const hash = await this.validateSigned(raw, { ...intent, from: ONLINE_OWNER })
    await this.verify()
    if (!this.m.validMiningProductCall(tx, this.d, true) || BigInt(await this.rpc.request('eth_gasPrice')) > PRICE_CAP || await this.nonce() !== nonce) throw new Error('Signed intent became stale')
    await this.rpc.request('eth_call', [tx, 'pending']); await this.fees(BigInt((raw.length - 2) / 2), gas)
    this.state.pending = { label, tx, raw, hash, gas: String(gas), price: String(price), nonce: String(nonce), submission: 'unknown' }; this.save()
    const response = await this.rpc.request('eth_sendRawTransaction', [raw])
    if (!same(response, hash)) throw new Error('Broadcast unknown; original hash saved')
    this.state.pending.submission = 'broadcast'; this.save()
    for (let i = 0; i < 90; i++) {
      const receipt = await this.rpc.request('eth_getTransactionReceipt', [hash])
      if (receipt && BigInt(await this.rpc.request('eth_blockNumber')) > BigInt(receipt.blockNumber)) return this.finish(receipt)
      await this.pause(2000)
    }
    throw new Error('Receipt unresolved; reconcile original hash only')
  }
  async finish(r) {
    const p = this.state.pending
    if (p && !same(await this.validateSigned(p.raw, { from: ONLINE_OWNER, nonce: BigInt(p.nonce), gas: BigInt(p.gas), gasPrice: BigInt(p.price), to: p.tx.to, data: p.tx.data, value: 0n }), p.hash)) throw new Error('Saved original raw hash changed')
    if (!p || !same(r.transactionHash, p.hash) || !same(r.from, ONLINE_OWNER) || !same(r.to, p.tx.to) || BigInt(r.gasUsed) > BigInt(p.gas) || BigInt(r.effectiveGasPrice) !== BigInt(p.price)) throw new Error('Receipt identity/cost mismatch')
    const b = await this.rpc.request('eth_getBlockByNumber', [r.blockNumber, false]), again = await this.rpc.request('eth_getTransactionReceipt', [p.hash])
    if (b.number !== r.blockNumber || b.hash !== r.blockHash || again?.blockHash !== r.blockHash || BigInt(await this.rpc.request('eth_blockNumber')) <= BigInt(r.blockNumber)) throw new Error('Receipt not canonical and confirmed')
    await this.fees(BigInt((p.raw.length - 2) / 2), BigInt(p.gas), r.blockNumber)
    for (const field of ['l1Fee', 'operatorFee', 'operatorFeeScalar', 'operatorFeeConstant']) if (BigInt(r[field] ?? 0)) throw new Error('Unknown fees; full pending reservation retained')
    this.state.actualOwnerFeesWei = String(BigInt(this.state.actualOwnerFeesWei) + BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice))
    const { raw: _raw, ...row } = p; this.state.transactions.push({ ...row, receipt: r }); this.state.pending = null; this.save()
    if (r.status !== '0x1') throw new Error('Smoke transaction reverted; stop')
    return r
  }
  async executePlan(plan, fabInputRaw = 0n) {
    if (fabInputRaw < 0n || BigInt(this.state.fabInputRaw) + fabInputRaw > FAB_CAP) throw new Error('Cumulative FAB principal cap exceeded')
    // Reserve all proposed input before approving or signing; unused allowance is conservatively counted.
    this.state.fabInputRaw = String(BigInt(this.state.fabInputRaw) + fabInputRaw); this.save()
    for (const [i, call] of plan.calls.entries()) await this.send(`${plan.action}:${i}`, call.tx)
  }
}
export async function runSmoke(s, api, signMessage) {
  const form = { name: 'TEST SodaDEX ONLINE', symbol: 'TEST-ONLINE', metadataURI: '' }, requestId = randomUUID()
  const status = await api.loadOnlineStatus(s.d)
  if (!status.admissionEnabled || !status.executionEnabled || !same(status.signer, S) || !same(status.keeper, KEEPER) || status.budget.capWei !== String(GAS_CAP)) throw new Error('Expected dedicated enabled 1952 service required')
  const challenge = await api.createLaunchChallenge(s.d, ONLINE_OWNER, requestId, form)
  s.state.challenge = challenge; s.save()
  const signature = await signMessage(challenge.message)
  const preview = await api.prepareOnlineLaunch(s.d, ONLINE_OWNER, challenge, signature)
  const receipt = await s.send('launch TEST-ONLINE', preview.tx)
  const registration = await api.registerOnlineLaunch(s.d, receipt.transactionHash)
  assertSmokeRegistration(receipt, s.d, registration.project)
  s.project = registration.project; await s.verify(); s.state.project = s.project; s.save()
  const plan = async (action, amount) => s.m.buildMiningPlan({ deployment: s.d, read: s.rpc.request.bind(s.rpc), account: ONLINE_OWNER, action, amount, slippageBps: 50, project: s.project })
  for (const amount of ['500', '5000']) { await s.executePlan(await plan('projectBuy', amount), BigInt(amount) * 100000000n); await s.verify() }
  if (!s.project.pair) throw new Error('Graduation pair missing')
  await s.executePlan(await plan('projectBuy', '1'), 100000000n)
  await s.executePlan(await plan('projectSell', '1000'))
  await api.requestOnlineCheck(s.d, s.project.token.address)
  const baseline = new Set(status.jobs.filter(j => j.status === 'confirmed' && j.kind !== 'purchase').map(j => j.hash))
  const confirmed = new Map()
  for (let i = 0; i < 40; i++) {
    const current = await api.loadOnlineStatus(s.d)
    const jobs = current.jobs.filter(j => j.status === 'confirmed' && j.hash && !baseline.has(j.hash) && (j.kind === 'purchase' || same(j.token, s.project.token.address)))
    s.state.serviceStatus = current; s.save()
    for (const job of jobs.filter(j => ['conversion', 'fund', 'purchase'].includes(j.kind) && !confirmed.has(j.kind))) {
      const r = await s.rpc.request('eth_getTransactionReceipt', [job.hash])
      if (!r || r.status !== '0x1' || !same(r.from, KEEPER) || !same(r.to, job.kind === 'purchase' ? s.d.contracts.farm.address : s.project.vault.address)) throw new Error('Automation receipt identity changed')
      const b = await s.rpc.request('eth_getBlockByNumber', [r.blockNumber, false])
      if (b.hash !== r.blockHash || BigInt(await s.rpc.request('eth_blockNumber')) <= BigInt(r.blockNumber)) continue
      confirmed.set(job.kind, r)
    }
    s.state.automationReceipts = Object.fromEntries(confirmed); s.save()
    if (['conversion', 'fund', 'purchase'].every(kind => confirmed.has(kind))) break
    if (i === 39) throw new Error('Automation pending; inspect saved status, do not rerun smoke')
    await s.pause(15000)
  }
  await s.executePlan(s.m.simpleMiningPlan(ONLINE_OWNER, s.project.holder.address, 'holder', 'claim', 'claim'))
  s.state.completed = true; s.save()
}
async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), args = process.argv.slice(2)
  if (!args.includes('--execute') && !args.includes('--reconcile-only')) { console.log(json({ dryRun: true, chainId: 1952, project: 'TEST-ONLINE', ownerGasCapWei: String(GAS_CAP), newApprovalFileRequired: true, signing: false, publicWrites: false })); return }
  const value = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1] }
  if (args.includes('--execute') && args.includes('--reconcile-only')) throw new Error('Choose one mode')
  const folder = path.join(root, '.analysis/mining-1952/online-smoke'), output = path.resolve(value('--journal', path.join(folder, 'private-journal.json')))
  const approval = JSON.parse(fs.readFileSync(path.join(root, 'deployments/xlayer-1952/2026-10-18-online-service-plan.json')))
  const assets = JSON.parse(fs.readFileSync(value('--asset-journal', path.join(root, '.analysis/mining-1952/online-assets/public-journal.json'))))
  validateSmokeApproval(approval, assets)
  const m = await loadSmokeModules(root, folder), deployment = m.parseMiningDeployment(JSON.parse(fs.readFileSync(path.join(root, 'deployments/xlayer-1952/products.json'))))
  const rpc = new OnlineAssetRpc(ONLINE_OWNER), wallet = path.join(os.homedir(), '.local/share/sodadex/wallets/xlayer-test-owner')
  const credentials = ['--keystore', path.join(wallet, 'owner'), '--password-file', path.join(wallet, 'password')]
  const sign = intent => execFileSync('cast', ['mktx', '--rpc-url', MINING_PUBLIC_RPC, '--chain', '1952', '--legacy', '--nonce', String(intent.nonce), '--gas-limit', String(intent.gas), '--gas-price', String(intent.gasPrice), '--value', '0', ...credentials, intent.to, intent.data], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const s = new SmokeSender({ rpc, modules: m, deployment, approval, assets, output, sign })
  if (args.includes('--reconcile-only')) {
    s.state = JSON.parse(fs.readFileSync(output)); if (s.state.approvalSha256 !== fileSha(json(approval)) || !same(s.state.owner, ONLINE_OWNER)) throw new Error('Journal approval changed')
    if (!s.state.pending) { console.log(json({ pending: false, transactions: s.state.transactions.length })); return }
    const receipt = await rpc.request('eth_getTransactionReceipt', [s.state.pending.hash])
    if (receipt) await s.finish(receipt)
    console.log(json({ pending: !!s.state.pending, resume: false })); return
  }
  const originalFetch = globalThis.fetch; globalThis.location = { origin: ORIGIN }
  globalThis.fetch = (input, init = {}) => {
    const url = new URL(String(input), ORIGIN)
    if (url.origin !== ORIGIN || !url.pathname.startsWith('/api/mining/')) throw new Error('Unexpected API destination')
    return originalFetch(url, { ...init, redirect: 'error', headers: { ...init.headers, Origin: ORIGIN } })
  }
  try { await s.start(); await runSmoke(s, m, message => execFileSync('cast', ['wallet', 'sign', ...credentials, message], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()) }
  finally { globalThis.fetch = originalFetch }
  console.log(json({ completed: true, ownerGasWei: s.state.actualOwnerFeesWei, project: s.project.token.address }))
}
if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main().catch(() => { console.error('1952 smoke stopped; inspect private journal and reconcile original hash before further action'); process.exitCode = 1 })
