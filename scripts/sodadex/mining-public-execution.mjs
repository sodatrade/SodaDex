// Public execution is a separate, explicitly invoked path after Git delivery and full rehearsal.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { getCreateAddress, keccak256, parseTransaction, recoverTransactionAddress, toHex } from 'viem'
import { LoopbackMiningPlan } from './mining-plan-rpc.mjs'
import { assertReviewedMiningIntent, miningExecutionSources } from './mining-reviewed-intent.mjs'
import { fileURLToPath } from 'node:url'
import { MINING_PUBLIC_RPC, VerifiedMiningRpc } from './mining-public-rpc.mjs'

const PUBLIC_RPC = MINING_PUBLIC_RPC
const ORACLE = '0x420000000000000000000000000000000000000f'
const equal = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const canonicalRepos = new Map([[root, 'sodatrade/SodaDex'], [path.join(os.homedir(), 'XTruthWorkspace/contract'), 'okasplaunchpad/contract']])

export function miningFeeReservation(rows, index, feeCap, actualFees, currentGas) {
  const rest = rows.slice(index + 1).reduce((sum, row) => sum + BigInt(row.gas) * feeCap, 0n)
  return actualFees + currentGas * feeCap + rest
}
export async function validateSignedMiningTransaction(raw, expected) {
  const tx = parseTransaction(raw)
  if (tx.type !== 'legacy' || tx.chainId !== 1952 || tx.nonce !== Number(expected.nonce) || tx.gas !== expected.gas ||
    tx.gasPrice !== expected.gasPrice || (tx.value ?? 0n) !== expected.value || !equal(tx.to, expected.to) ||
    !equal(tx.data, expected.data) || !equal(await recoverTransactionAddress({ serializedTransaction: raw }), expected.from))
    throw new Error('Signed transaction differs from the reviewed intent')
  return keccak256(raw)
}

export class PublicMiningExecution extends LoopbackMiningPlan {
  constructor(owner, output, rehearsal, delivery, policy) {
    super(owner, output, rehearsal.feeCap)
    this.rehearsal = rehearsal; this.delivery = delivery; this.policy = policy; this.actualFees = 0n
    this.transport = new VerifiedMiningRpc(owner)
    this.journalOwned = false
  }
  async rpc(method, params = []) {
    return this.transport.request(method, params)
  }
  save() {
    if (!this.journalOwned) throw new Error('This process does not own the public journal')
    const journal = { schemaVersion: 1, chainId: 1952, publicTestnet: true, productionTouched: false, owner: this.owner,
      delivery: this.delivery, startNonce: '16', feeCap: String(this.feeCap), actualFeesWei: String(this.actualFees),
      transactions: this.rows, pending: this.pending ?? null, contracts: this.contracts, stack: this.stack, miners: this.miners,
      permit2Proof: this.permit2Proof, business: this.business, businessPrincipal: this.businessPrincipal, failure: this.failure }
    fs.writeFileSync(`${this.output}.tmp`, JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 })
    fs.renameSync(`${this.output}.tmp`, this.output)
  }
  async start() {
    if (!this.rehearsal.localForkOnly || this.rehearsal.broadcast !== false || this.rehearsal.chainId !== 1952 ||
      this.rehearsal.budgetPassed !== true || this.rehearsal.business?.completed !== true || this.rehearsal.startNonce !== '16' ||
      !equal(this.rehearsal.owner, this.owner) || BigInt(this.rehearsal.totalFeeUpperBound) > BigInt(this.policy.phaseBudget.gasWei))
      throw new Error('A complete passing 1952 rehearsal is required')
    if (fs.existsSync(this.output)) throw new Error('Public journal already exists: inspect hashes and receipts before recovery; never replay blindly')
    if (JSON.stringify(this.rehearsal.executionSourceSha256) !== JSON.stringify(miningExecutionSources(root))) throw new Error('Execution sources differ from the complete rehearsal')
    const locators = (this.delivery.repositories ?? []).map((repo) => fs.realpathSync(repo.path))
    if (locators.length !== 2 || new Set(locators).size !== 2 || locators.some((dir) => !canonicalRepos.has(dir))) throw new Error('Both distinct canonical source repositories are required')
    if (await this.rpc('eth_chainId') !== '0x7a0' || /anvil|hardhat/i.test(await this.rpc('web3_clientVersion'))) throw new Error('Public 1952 required')
    const seen = new Set()
    for (const repo of this.delivery.repositories ?? []) {
      const real = fs.realpathSync(repo.path), expectedOrigin = canonicalRepos.get(real)
      if (!expectedOrigin || seen.has(real)) throw new Error('Both distinct canonical source repositories are required')
      seen.add(real)
      const git = (...args) => execFileSync('git', ['-C', repo.path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
      const origin = git('remote', 'get-url', 'origin').replace(/^git@github.com:/, '').replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '')
      if (origin.toLowerCase() !== expectedOrigin.toLowerCase() || git('branch', '--show-current') !== 'codex/feat/mining-products-1952' || git('rev-parse', 'HEAD') !== repo.head || git('status', '--porcelain') !== '' ||
        git('ls-remote', '--heads', 'origin', 'refs/heads/codex/feat/mining-products-1952').split(/\s/)[0] !== repo.head)
        throw new Error('Deployment requires the exact clean, published requirement branch')
    }
    if (this.delivery.repositories?.length !== 2) throw new Error('Both source deliveries are required')
    this.startNonce = BigInt(await this.rpc('eth_getTransactionCount', [this.owner, 'pending']))
    if (this.startNonce !== 16n || BigInt(await this.rpc('eth_getTransactionCount', [this.owner, 'latest'])) !== 16n) throw new Error('Public nonce changed: rebuild the entire deployment plan')
    await this.checkFeeModel(0n, 0n)
    fs.closeSync(fs.openSync(this.output, 'wx', 0o600)); this.journalOwned = true; this.save()
  }
  async checkFeeModel(bytes, gas) {
    if (BigInt(await this.rpc('eth_gasPrice')) > this.feeCap ||
      await this.call(ORACLE, 'function isFjord() view returns(bool)') !== true ||
      await this.call(ORACLE, 'function isIsthmus() view returns(bool)') !== true ||
      await this.call(ORACLE, 'function operatorFeeScalar() view returns(uint256)') !== 0n ||
      await this.call(ORACLE, 'function operatorFeeConstant() view returns(uint256)') !== 0n ||
      await this.call(ORACLE, 'function getL1FeeUpperBound(uint256) view returns(uint256)', [bytes]) !== 0n ||
      await this.call(ORACLE, 'function getOperatorFee(uint256) view returns(uint256)', [gas]) !== 0n)
      throw new Error('Fee model or price changed: stop and refresh the full budget')
  }
  async mineAfterBlock(anchor) {
    for (let attempt = 0; attempt < 90; attempt++) {
      if (BigInt(await this.rpc('eth_blockNumber')) > anchor) return
      await sleep(1000)
    }
    throw new Error('Public block wait timed out; no development RPC is allowed')
  }
  async advanceRewards(seconds) {
    const start = BigInt((await this.rpc('eth_getBlockByNumber', ['latest', false])).timestamp)
    for (let attempt = 0; attempt < seconds + 120; attempt++) {
      if (BigInt((await this.rpc('eth_getBlockByNumber', ['latest', false])).timestamp) >= start + BigInt(seconds)) return
      await sleep(1000)
    }
    throw new Error('Public reward interval wait timed out')
  }
  async send(label, to, data, value = 0n) {
    if (this.pending) throw new Error('A prior submission needs receipt reconciliation')
    const row = this.rehearsal.transactions[this.rows.length]
    if (!row || row.label !== label || !equal(row.to, to) || row.data.slice(0, 10) !== data.slice(0, 10)) throw new Error('Execution order or target differs from rehearsal')
    await assertReviewedMiningIntent(this, root, row, to, data, value)
    const nonce = this.startNonce + BigInt(this.rows.length)
    if (BigInt(await this.rpc('eth_getTransactionCount', [this.owner, 'pending'])) !== nonce ||
      BigInt(await this.rpc('eth_getTransactionCount', [this.owner, 'latest'])) !== nonce) throw new Error('Owner nonce drifted')
    if (!to && !equal(getCreateAddress({ from: this.owner, nonce }), row.created)) throw new Error('Creation address differs from rehearsal')
    const tx = { from: this.owner, ...(to ? { to } : {}), data, value: toHex(value) }
    await this.rpc('eth_call', [tx, 'pending'])
    const estimate = BigInt(await this.rpc('eth_estimateGas', [tx, 'pending'])), margin = to ? 120n : 105n
    const gas = (estimate * margin + 99n) / 100n
    if (miningFeeReservation(this.rehearsal.transactions, this.rows.length, this.feeCap, this.actualFees, gas) > BigInt(this.policy.phaseBudget.gasWei))
      throw new Error('Phase gas reservation exceeds the approved limit')
    await this.checkFeeModel(BigInt(data.length / 2 + 256), gas)
    if (BigInt(await this.rpc('eth_getBalance', [this.owner, 'pending'])) < value + gas * this.feeCap) throw new Error('Insufficient public test balance')
    const raw = await this.signIntent({ nonce, gas, value, to, data })
    const hash = await validateSignedMiningTransaction(raw, { from: this.owner, to, data, value, gas, gasPrice: this.feeCap, nonce })
    await this.checkFeeModel(BigInt((raw.length - 2) / 2), gas)
    this.pending = { label, nonce: String(nonce), to: to ?? null, dataKeccak256: keccak256(data), value: String(value), gas: String(gas), hash, submission: 'unknown' }; this.save()
    if (!equal(await this.rpc('eth_sendRawTransaction', [raw]), hash)) throw new Error('Submission result is uncertain; reconcile the saved hash')
    this.pending.submission = 'broadcast'; this.save()
    let receipt
    for (let attempt = 0; attempt < 180; attempt++) {
      receipt = await this.rpc('eth_getTransactionReceipt', [hash])
      if (receipt && BigInt(await this.rpc('eth_blockNumber')) >= BigInt(receipt.blockNumber) + 1n) break
      receipt = undefined; await sleep(1000)
    }
    if (!receipt) throw new Error('Receipt pending: retain reservation and saved hash')
    const header = await this.rpc('eth_getBlockByNumber', [receipt.blockNumber, false])
    const again = await this.rpc('eth_getTransactionReceipt', [hash])
    if (!again || header.hash !== receipt.blockHash || again.blockHash !== receipt.blockHash || !equal(receipt.from, this.owner) || !equal(receipt.to, to) ||
      !equal(receipt.transactionHash, hash) || BigInt(receipt.gasUsed) > gas || BigInt(receipt.effectiveGasPrice) !== this.feeCap ||
      (!to && !equal(receipt.contractAddress, row.created)))
      throw new Error('Receipt identity or canonical block changed')
    const extra = BigInt(receipt.l1Fee ?? '0x0') + BigInt(receipt.operatorFee ?? '0x0')
    const unresolved = BigInt(receipt.operatorFeeScalar ?? '0x0') !== 0n || BigInt(receipt.operatorFeeConstant ?? '0x0') !== 0n
    const fee = BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) + extra
    this.actualFees += fee
    this.rows.push({ ...this.pending, hash, status: receipt.status, created: receipt.contractAddress, gasUsed: String(BigInt(receipt.gasUsed)),
      feeWei: String(fee), costStatus: unresolved ? 'unresolved' : 'known', receipt,
      blockNumber: receipt.blockNumber, blockHash: receipt.blockHash })
    if (extra !== 0n || unresolved) {
      this.pending.receipt = receipt; this.pending.costStatus = 'unresolved'; this.save()
      throw new Error('Fee model changed: full receipt retained; reconcile costs before any continuation')
    }
    this.pending = undefined; this.save()
    if (receipt.status !== '0x1') throw new Error(`Public test transaction reverted: ${label}`)
    return receipt
  }
  async signIntent({ nonce, gas, value, to, data }) {
    const folder = path.join(os.homedir(), '.local/share/sodadex/wallets/xlayer-test-owner')
    const args = ['mktx', '--rpc-url', PUBLIC_RPC, '--chain', '1952', '--legacy', '--nonce', String(nonce), '--gas-limit', String(gas),
      '--gas-price', String(this.feeCap), '--value', String(value), '--keystore', path.join(folder, 'owner'), '--password-file', path.join(folder, 'password'),
      ...(to ? [to, data] : ['--create', data])]
    return execFileSync('cast', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  }
}
