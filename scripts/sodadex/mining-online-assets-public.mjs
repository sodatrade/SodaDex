// Public writes require a new online-assets approval. Default CLI never constructs this runner.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { toHex } from 'viem'
import { LoopbackMiningPlan } from './mining-plan-rpc.mjs'
import { VerifiedMiningRpc, MINING_PUBLIC_RPC } from './mining-public-rpc.mjs'
import { validateSignedMiningTransaction } from './mining-public-execution.mjs'
import { fileSha, sourceArtifact } from './mining-plan-artifacts.mjs'
import { ONLINE_PHASE, ONLINE_OWNER, onlineSources, onlineSnapshot, verifyOnlineRoots, assertOnlineIntent, assertMiningFeeParameters, same, json } from './mining-online-assets.mjs'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
export class OnlineAssetRpc extends VerifiedMiningRpc {
  constructor(owner, fetcher = fetch, { now = Date.now, wait = sleep, windowMs = 60_000 } = {}) {
    super(owner, fetcher, 1); Object.assign(this, { now, wait, windowMs })
  }
  async request(method, params = []) {
    const start = this.now()
    while (true) {
      try { return await super.request(method, params) }
      catch (e) {
        if (method === 'eth_sendRawTransaction' || !params.includes('pending') ||
            !String(e?.message).includes('snapshot stayed stale or unavailable') || this.now() - start >= this.windowMs) throw e
        await this.wait(Math.min(2000, this.windowMs - (this.now() - start)))
      }
    }
  }
}
export function validateOnlineApproval(rehearsal, bytes, policy, delivery) {
  if (rehearsal.phase !== ONLINE_PHASE || rehearsal.chainId !== 1952 || !rehearsal.localForkOnly || rehearsal.publicWrites !== false ||
      rehearsal.rehearsalPassed !== true || rehearsal.result?.completed !== true || !same(rehearsal.owner, ONLINE_OWNER) ||
      rehearsal.transactions.length !== (rehearsal.draft?.keeper ? 14 : 13) || rehearsal.transactions.some(r => r.status !== '0x1')) throw new Error('Passing independent online-assets rehearsal required')
  if (policy.phase !== ONLINE_PHASE || policy.chainId !== 1952 || policy.stage !== 'test' || policy.approved !== true ||
      typeof policy.approvalReference !== 'string' || !policy.approvalReference.trim() || policy.keyRole !== 'local-1952-test-owner' ||
      !same(policy.owner, ONLINE_OWNER) || policy.expectedOwnerNonce !== rehearsal.startNonce ||
      policy.planSha256 !== fileSha(bytes) || delivery.planSha256 !== fileSha(bytes) ||
      delivery.policySha256 !== fileSha(json(policy)) || delivery.phase !== ONLINE_PHASE) throw new Error('New exact online-assets approval and delivery required; old phase authority is not reusable')
  for (const field of ['gasCapWei', 'liquidityNativeWei', 'liquidityFabRaw', 'keeperFundingWei']) if (typeof policy[field] !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(policy[field])) throw new Error('Explicit decimal spending caps required')
  if (BigInt(policy.gasCapWei) < BigInt(rehearsal.totalFeeUpperBoundWei) || policy.liquidityNativeWei !== rehearsal.draft.lp.nativeWei ||
      policy.liquidityFabRaw !== rehearsal.draft.lp.fabRaw || policy.keeperFundingWei !== rehearsal.draft.keeperFundingWei ||
      !same(policy.keeper, rehearsal.draft.keeper) || policy.listingPriceWei !== rehearsal.draft.listingPriceWei || policy.nftCount !== 2) throw new Error('Approved online-assets caps differ from reviewed plan')
  const sum = rehearsal.transactions.reduce((n, r) => n + BigInt(r.gas) * BigInt(rehearsal.feeCapWei), 0n)
  if (sum !== BigInt(rehearsal.totalFeeUpperBoundWei) || rehearsal.transactions.some((r, i) => BigInt(r.nonce) !== BigInt(rehearsal.startNonce) + BigInt(i))) throw new Error('Frozen nonce/gas reservation changed')
}
function durableJson(file, value) {
  const tmp = `${file}.tmp`, fd = fs.openSync(tmp, 'w', 0o600)
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, file)
}
export function assertOnlineDelivery(root, delivery) {
  const canonical = [[root, 'sodatrade/SodaDex'], [path.join(os.homedir(), 'XTruthWorkspace/contract'), 'okasplaunchpad/contract']]
  if (delivery.repositories?.length !== 2) throw new Error('Exact canonical source delivery required')
  for (const [directory, origin] of canonical) {
    const identity = delivery.repositories.find(row => row.repository === origin)
    const git = (...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    const remote = git('remote', 'get-url', 'origin').replace(/^git@github.com:/, '').replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '')
    if (!identity || remote.toLowerCase() !== origin.toLowerCase() || git('branch', '--show-current') !== 'codex/feat/mining-products-1952' ||
        git('rev-parse', 'HEAD') !== identity.head || git('status', '--porcelain') !== '' ||
        git('ls-remote', '--heads', 'origin', 'refs/heads/codex/feat/mining-products-1952').split(/\s/)[0] !== identity.head) throw new Error('Exact clean pushed online requirement branches required')
  }
}
export class PublicOnlineAssets extends LoopbackMiningPlan {
  constructor({ root, artifactRoot, output, rehearsal, bytes, policy, delivery, transport, signer, rootVerifier = verifyOnlineRoots }) {
    super(ONLINE_OWNER, output, rehearsal.feeCapWei)
    Object.assign(this, { root, artifactRoot, rehearsal, bytes, policy, delivery, signer })
    this.rootVerifier = rootVerifier
    this.transport = transport ?? new OnlineAssetRpc(ONLINE_OWNER)
    this.actualFees = 0n; this.owned = false; this.startNonce = BigInt(rehearsal.startNonce)
  }
  rpc(method, params = []) { return this.transport.request(method, params) }
  save() {
    if (!this.owned) throw new Error('Public online journal is not owned by this process')
    durableJson(this.output, { schemaVersion: 1, phase: ONLINE_PHASE, chainId: 1952, publicTestnet: true, productionTouched: false,
      owner: this.owner, startNonce: String(this.startNonce), planSha256: fileSha(this.bytes), delivery: this.delivery,
      gasCapWei: this.policy.gasCapWei, actualFeesWei: String(this.actualFees),
      reservedGasWei: String(this.rehearsal.transactions.slice(this.rows.length).reduce((n, r) => n + BigInt(r.gas) * this.feeCap, 0n)), pending: this.pending ?? null,
      transactions: this.rows, result: this.result, failure: this.failure })
  }
  async start() {
    validateOnlineApproval(this.rehearsal, this.bytes, this.policy, this.delivery)
    if (fs.existsSync(this.output)) throw new Error('Public online journal exists: reconcile original hash; never replay')
    if (json(onlineSources(this.root)) !== json(this.rehearsal.draft.sourceSha256)) throw new Error('Frozen online execution sources changed')
    for (const [name, sha] of Object.entries(this.rehearsal.draft.artifactSha256)) if (fileSha(fs.readFileSync(sourceArtifact(this.artifactRoot, name).file)) !== sha) throw new Error('Frozen compiled artifact changed')
    assertOnlineDelivery(this.root, this.delivery)
    if (await this.rpc('eth_chainId') !== '0x7a0' || /anvil|hardhat/i.test(await this.rpc('web3_clientVersion'))) throw new Error('Public 1952 only')
    const live = await onlineSnapshot(this, this.root, this.artifactRoot, this.rehearsal.draft.keeper, BigInt(this.rehearsal.draft.keeperFundingWei))
    for (const key of ['startNonce', 'nextId', 'nextListingId', 'sampleCount', 'transistors', 'pair', 'reserveFabRaw', 'reserveNativeWei', 'lp', 'reservedRetail']) if (json(live[key]) !== json(this.rehearsal.draft[key])) throw new Error(`Online phase boundary changed: ${key}`)
    const nonce = BigInt(await this.rpc('eth_getTransactionCount', [this.owner, 'pending']))
    if (nonce !== this.startNonce || BigInt(await this.rpc('eth_getTransactionCount', [this.owner, 'latest'])) !== nonce) throw new Error('Public owner nonce drifted')
    await this.checkFees(0n, 0n)
    const required = BigInt(this.policy.gasCapWei) + BigInt(this.policy.liquidityNativeWei) + BigInt(this.policy.keeperFundingWei)
    if (BigInt(await this.rpc('eth_getBalance', [this.owner, 'pending'])) < required ||
        await this.call(live.roots.d.contracts.fab.address, 'function balanceOf(address) view returns(uint256)', [this.owner]) < BigInt(this.policy.liquidityFabRaw)) throw new Error('Public test assets insufficient for exact caps')
    fs.closeSync(fs.openSync(this.output, 'wx', 0o600)); this.owned = true; this.save()
  }
  async checkFees(bytes, gas, block) {
    // Current prices gate new signatures/broadcasts; mined receipt costs use their canonical historical block.
    if (block === undefined && BigInt(await this.rpc('eth_gasPrice')) > this.feeCap) throw new Error('Gas price exceeds frozen cap')
    await assertMiningFeeParameters({ call: (to, sig, args = []) => this.call(to, sig, args, block ?? 'latest') }, bytes, gas)
  }
  async mineAfterBlock(anchor) {
    for (let i = 0; i < 90; i++) { if (BigInt(await this.rpc('eth_blockNumber')) > anchor) return; await sleep(1000) }
    throw new Error('Public mining anchor wait timed out; no development RPC is permitted')
  }
  async signIntent(intent) {
    if (this.signer) return this.signer(intent)
    const wallet = path.join(os.homedir(), '.local/share/sodadex/wallets/xlayer-test-owner')
    return execFileSync('cast', ['mktx', '--rpc-url', MINING_PUBLIC_RPC, '--chain', '1952', '--legacy', '--nonce', String(intent.nonce),
      '--gas-limit', String(intent.gas), '--gas-price', String(this.feeCap), '--value', String(intent.value),
      '--keystore', path.join(wallet, 'owner'), '--password-file', path.join(wallet, 'password'), intent.to, intent.data],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  }
  async send(label, to, data, value = 0n) {
    if (this.pending) throw new Error('Prior online submission unresolved')
    const row = this.rehearsal.transactions[this.rows.length]
    if (!row || row.label !== label) throw new Error('Frozen online transaction order changed')
    for (const settled of this.rows) {
      const canonical = await this.rpc('eth_getBlockByNumber', [settled.receipt.blockNumber, false])
      const receipt = await this.rpc('eth_getTransactionReceipt', [settled.hash])
      if (canonical.hash !== settled.receipt.blockHash || receipt?.blockHash !== settled.receipt.blockHash || receipt.gasUsed !== settled.receipt.gasUsed || receipt.status !== settled.status) throw new Error('Earlier online receipt changed; stop and reconcile every cost before continuing')
    }
    await assertOnlineIntent(this, row, to, data, value, this.rehearsal.draft, this.artifactRoot)
    await this.rootVerifier(this, this.root)
    const nonce = this.startNonce + BigInt(this.rows.length), gas = BigInt(row.gas)
    if (BigInt(await this.rpc('eth_getTransactionCount', [this.owner, 'pending'])) !== nonce || BigInt(await this.rpc('eth_getTransactionCount', [this.owner, 'latest'])) !== nonce) throw new Error('Online owner nonce drifted')
    const tx = { from: this.owner, to, data, value: toHex(value) }
    await this.rpc('eth_call', [tx, 'pending'])
    if (BigInt(await this.rpc('eth_estimateGas', [tx, 'pending'])) > gas) throw new Error('Public gas exceeds frozen reviewed limit')
    const reservation = this.actualFees + this.rehearsal.transactions.slice(this.rows.length).reduce((n, r) => n + BigInt(r.gas) * this.feeCap, 0n)
    if (reservation > BigInt(this.policy.gasCapWei)) throw new Error('Online gas cap exhausted')
    await this.checkFees(BigInt(data.length / 2 + 256), gas)
    const raw = await this.signIntent({ nonce, gas, value, to, data })
    const hash = await validateSignedMiningTransaction(raw, { from: this.owner, nonce, gas, gasPrice: this.feeCap, value, to, data: data === '0x' ? undefined : data })
    // Recheck dynamic bounds and pending simulation after potentially slow signing; no stale proof/deadline is sent.
    await assertOnlineIntent(this, row, to, data, value, this.rehearsal.draft, this.artifactRoot)
    await this.rpc('eth_call', [tx, 'pending']); await this.checkFees(BigInt((raw.length - 2) / 2), gas)
    this.pending = { label, nonce: String(nonce), to, data, value: String(value), gas: String(gas), raw, hash, submission: 'unknown' }; this.save()
    const returned = await this.rpc('eth_sendRawTransaction', [raw]) // exactly one attempt, even when the response is lost
    if (!same(returned, hash)) throw new Error('Online broadcast unknown; reconcile saved hash')
    this.pending.submission = 'broadcast'; this.save()
    for (let i = 0; i < 180; i++) {
      const receipt = await this.rpc('eth_getTransactionReceipt', [hash])
      if (receipt && BigInt(await this.rpc('eth_blockNumber')) > BigInt(receipt.blockNumber)) return this.finish(receipt)
      await sleep(1000)
    }
    throw new Error('Online receipt pending; preserve journal and reservation')
  }
  async finish(receipt) {
    const p = this.pending, reviewed = this.rehearsal.transactions[this.rows.length]
    if (!p || !reviewed || p.label !== reviewed.label || p.nonce !== reviewed.nonce || !same(p.to, reviewed.to) ||
        p.value !== reviewed.value || p.gas !== reviewed.gas) throw new Error('Pending intent differs from frozen online plan')
    const actualHash = await validateSignedMiningTransaction(p.raw, { from: this.owner, nonce: BigInt(p.nonce), to: p.to, data: p.data === '0x' ? undefined : p.data, value: BigInt(p.value), gas: BigInt(p.gas), gasPrice: this.feeCap })
    if (!same(actualHash, p.hash)) throw new Error('Pending raw hash changed')
    if (BigInt(await this.rpc('eth_blockNumber')) <= BigInt(receipt.blockNumber)) throw new Error('Online receipt requires another canonical block')
    if (!p || !same(receipt.transactionHash, p.hash) || !same(receipt.from, this.owner) || !same(receipt.to, p.to) || BigInt(receipt.gasUsed) > BigInt(p.gas) ||
        BigInt(receipt.effectiveGasPrice) !== this.feeCap) throw new Error('Online receipt identity/cost mismatch')
    const block = await this.rpc('eth_getBlockByNumber', [receipt.blockNumber, false])
    const again = await this.rpc('eth_getTransactionReceipt', [p.hash])
    if (block.number !== receipt.blockNumber || block.hash !== receipt.blockHash || again?.blockHash !== receipt.blockHash) throw new Error('Online receipt reorg')
    this.pending.receipt = receipt; this.save()
    await this.checkFees(BigInt((p.raw.length - 2) / 2), BigInt(p.gas), receipt.blockNumber)
    if (BigInt(receipt.l1Fee ?? 0) || BigInt(receipt.operatorFee ?? 0) || BigInt(receipt.operatorFeeScalar ?? 0) || BigInt(receipt.operatorFeeConstant ?? 0)) throw new Error('Unknown additional fees: reserve retained')
    const fee = BigInt(receipt.gasUsed) * this.feeCap
    this.actualFees += fee
    const { raw: _raw, ...publicRow } = p
    this.rows.push({ ...publicRow, status: receipt.status, gasUsed: String(BigInt(receipt.gasUsed)), feeWei: String(fee), receipt })
    this.pending = undefined; this.save()
    if (receipt.status !== '0x1') throw new Error('Online asset transaction reverted; never skip or replay it')
    return receipt
  }
}
export async function reconcileOnlineJournal(plan) {
  // Read-only reconciliation: this intentionally cannot resume or send another transaction.
  if (!plan.pending?.hash) return { pending: false, confirmed: plan.rows.length }
  const receipt = await plan.rpc('eth_getTransactionReceipt', [plan.pending.hash])
  if (!receipt) return { pending: true, hash: plan.pending.hash, reason: 'unknown_keep_full_reservation' }
  await plan.finish(receipt)
  return { pending: false, reconciledHash: receipt.transactionHash, status: receipt.status, mustReviewRemainingIntents: true }
}
