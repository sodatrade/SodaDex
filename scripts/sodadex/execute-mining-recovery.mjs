#!/usr/bin/env node
// Explicit, narrowly scoped continuation of four confirmed1952 CREATEs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseTransaction, toHex } from 'viem'
import { PublicMiningExecution } from './mining-public-execution.mjs'
import { miningExecutionSources, assertReviewedMiningIntent } from './mining-reviewed-intent.mjs'
import { recoveringMiningRpc, validateFourCreateJournal, verifyFourCreateCheckpoint, installFourCreateReuse } from './mining-public-recovery.mjs'
import { prepareMiningStack } from './mining-plan-stack.mjs'
import { prepareMiningNfts } from './mining-plan-nfts.mjs'
import { exerciseMiningProducts } from './mining-plan-business.mjs'
import { saveRecoveredMiningManifest } from './mining-recovery-manifest.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const folder = path.join(root, '.analysis/mining-1952/stage2-plan')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const read = (file) => JSON.parse(fs.readFileSync(file))
const sourceNames = ['execute-mining-recovery.mjs', 'mining-public-recovery.mjs', 'mining-recovery-manifest.mjs', 'test-mining-public-recovery.mjs']
const sourceHashes = Object.fromEntries(sourceNames.map((name) => [name, digest(fs.readFileSync(path.join(root, 'scripts/sodadex', name)))]))
const originalBytes = fs.readFileSync(path.join(folder, 'public-journal.json')), original = JSON.parse(originalBytes)
const rehearsalBytes = fs.readFileSync(path.join(folder, 'unsigned.json')), rehearsal = JSON.parse(rehearsalBytes)
const originalDeliveryBytes = fs.readFileSync(path.join(folder, 'public-delivery.json')), originalDelivery = JSON.parse(originalDeliveryBytes)
const policy = read(path.join(root, 'deployments/xlayer-1952/test-policy.json'))
const budget = validateFourCreateJournal(original, rehearsal, policy)
if (!process.argv.includes('--execute-1952')) {
  console.log(JSON.stringify({ publicExecution: false, confirmedPrefix: 4, remaining: 98, reservedPhaseWei: String(budget.reservedPhaseWei), capWei: policy.phaseBudget.gasWei, recoverySourceSha256: sourceHashes }))
  process.exit(0)
}
const bindingBytes = fs.readFileSync(path.join(folder, 'recovery-delivery.json')), binding = JSON.parse(bindingBytes)
const proofBytes = fs.readFileSync(path.join(folder, 'recovery-local-proof.json')), proof = JSON.parse(proofBytes)
if (binding.originalJournalSha256 !== digest(originalBytes) || binding.originalDeliverySha256 !== digest(originalDeliveryBytes) ||
  binding.rehearsalSha256 !== digest(rehearsalBytes) || originalDelivery.rehearsalSha256 !== digest(rehearsalBytes) ||
  JSON.stringify(original.delivery) !== JSON.stringify(originalDelivery) ||
  JSON.stringify(binding.recoverySourceSha256) !== JSON.stringify(sourceHashes) ||
  JSON.stringify(rehearsal.executionSourceSha256) !== JSON.stringify(miningExecutionSources(root)))
  throw new Error('Recovery source, original journal or frozen rehearsal changed')
if (binding.localProofSha256 !== digest(proofBytes) || proof.localForkOnly !== true || proof.broadcast !== false || proof.passed !== true ||
  proof.originalRehearsalSha256 !== digest(rehearsalBytes) || proof.prefixCreates !== 4 || proof.prefixRebroadcasts !== 0 ||
  proof.nextNonce !== 20 || proof.resultingHistoryVersion !== 2 || proof.ownerUnchanged !== true)
  throw new Error('Passing local four-CREATE continuation proof is required')
const expectedRepos = new Map([[root, 'sodatrade/SodaDex'], [path.join(os.homedir(), 'XTruthWorkspace/contract'), 'okasplaunchpad/contract']])
const paths = (binding.repositories ?? []).map((repo) => fs.realpathSync(repo.path))
if (paths.length !== 2 || new Set(paths).size !== 2 || paths.some((dir) => !expectedRepos.has(dir))) throw new Error('Both canonical repositories required')
for (const repo of binding.repositories) {
  const dir = fs.realpathSync(repo.path), git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const old = originalDelivery.repositories.find((r) => fs.realpathSync(r.path) === dir)
  const origin = git('remote', 'get-url', 'origin').replace(/^git@github.com:/, '').replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '')
  if (!old || origin.toLowerCase() !== expectedRepos.get(dir).toLowerCase() || git('branch', '--show-current') !== 'codex/feat/mining-products-1952' ||
    git('rev-parse', 'HEAD') !== repo.head || git('status', '--porcelain') ||
    git('ls-remote', '--heads', 'origin', 'refs/heads/codex/feat/mining-products-1952').split(/\s/)[0] !== repo.head)
    throw new Error('Recovery requires exact clean, published requirement HEADs')
  git('merge-base', '--is-ancestor', old.head, repo.head)
  const diff = git('diff', '--name-status', old.head, repo.head)
  const allowed = new Set(sourceNames.map((name) => `scripts/sodadex/${name}`))
  if (dir === root ? diff.split('\n').some((line) => { const [status, file] = line.split('\t'); return status !== 'A' || !allowed.has(file) }) : diff !== '')
    throw new Error('Recovery revision may only add reviewed recovery files')
}
const output = path.join(folder, 'public-recovery-journal.json'), lock = path.join(folder, 'recovery.lock')
const plan = new PublicMiningExecution(original.owner, output, rehearsal, {
  ...originalDelivery, recovery: { originalJournalSha256: digest(originalBytes), recoveryDeliverySha256: digest(bindingBytes), repositories: binding.repositories, recoverySourceSha256: sourceHashes },
}, policy)
plan.transport = recoveringMiningRpc(original.owner)
const request = plan.rpc.bind(plan)
plan.rpc = async (method, params = []) => {
  if (method === 'eth_sendRawTransaction') {
    const tx = parseTransaction(params[0])
    await assertReviewedMiningIntent(plan, root, rehearsal.transactions[plan.rows.length], tx.to, tx.data, tx.value ?? 0n)
    // Recheck after signing/fee reads as well: waiting for a fresh backend must
    // never result in broadcasting an expired authorization.
    await request('eth_call', [{ from: plan.owner, ...(tx.to ? { to: tx.to } : {}), data: tx.data, value: toHex(tx.value ?? 0n) }, 'pending'])
  }
  return request(method, params)
}
let lockOwned = false
try {
  if (fs.existsSync(output)) throw new Error('Recovery journal exists; inspect saved hashes and receipts before continuation')
  fs.closeSync(fs.openSync(lock, 'wx', 0o600)); lockOwned = true
  if (/anvil|hardhat/i.test(await plan.rpc('web3_clientVersion'))) throw new Error('Public1952 is required')
  await verifyFourCreateCheckpoint(plan, original, rehearsal, policy)
  if (digest(fs.readFileSync(path.join(folder, 'public-journal.json'))) !== digest(originalBytes)) throw new Error('Original journal changed during verification')
  plan.startNonce = 16n; plan.rows = structuredClone(original.transactions); plan.contracts = structuredClone(original.contracts); plan.actualFees = budget.actualFees
  fs.closeSync(fs.openSync(output, 'wx', 0o600)); plan.journalOwned = true; plan.save()
  const reused = installFourCreateReuse(plan, rehearsal, original)
  const sign = plan.signIntent.bind(plan)
  plan.signIntent = async (tx) => {
    // Read retries may consume a short-lived authorization's validity window.
    await assertReviewedMiningIntent(plan, root, rehearsal.transactions[plan.rows.length], tx.to, tx.data, tx.value)
    await plan.rpc('eth_call', [{ from: plan.owner, ...(tx.to ? { to: tx.to } : {}), data: tx.data, value: `0x${tx.value.toString(16)}` }, 'pending'])
    return sign(tx)
  }
  const signer = read(path.join(os.homedir(), '.local/share/sodadex/wallets/xlayer-1952-mining-authorizer/public.json'))
  if (signer.chainId !== 1952 || signer.address.toLowerCase() !== rehearsal.stack.signer.toLowerCase()) throw new Error('Recovery authorizer differs')
  const stack = await prepareMiningStack(plan, root, signer.address)
  if (!reused()) throw new Error('Recovery prefix was not fully verified')
  await prepareMiningNfts(plan, root, stack)
  await exerciseMiningProducts(plan, root, stack)
  const manifest = await saveRecoveredMiningManifest(plan, root, originalDelivery)
  console.log(JSON.stringify({ deployed1952: true, recoveredCreates: 4, confirmedTransactions: plan.rows.length, actualGasFeeWei: String(plan.actualFees), addresses: manifest, productionTouched: false }))
} catch (error) {
  plan.failure = error instanceof Error ? error.message : 'Recovery stopped'
  if (plan.journalOwned) plan.save()
  console.error(plan.failure.slice(0, 400)); process.exitCode = 1
} finally { if (lockOwned) fs.unlinkSync(lock) }
