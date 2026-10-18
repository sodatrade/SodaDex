#!/usr/bin/env node
// Owned loopback fork only: no keystore access and no public writes.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serializeTransaction } from 'viem'
import { LoopbackMiningPlan } from './mining-plan-rpc.mjs'
import { fileSha } from './mining-plan-artifacts.mjs'
import { ONLINE_OWNER, ONLINE_PHASE, onlineSources, onlineSnapshot, runOnlineAssets, assertMiningFeeParameters } from './mining-online-assets.mjs'
export const ONLINE_LOOPBACK = 'http://127.0.0.1:8955'
export class OnlineLoopbackPlan extends LoopbackMiningPlan {
  constructor(output, feeCap, fetcher = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) { super(ONLINE_OWNER, output, feeCap, fetcher); this.wait = wait }
  async rpc(method, params = []) {
    const reads = new Set(['eth_chainId', 'web3_clientVersion', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode',
      'eth_getStorageAt', 'eth_getTransactionCount', 'eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_getBalance',
      'eth_getTransactionReceipt', 'anvil_nodeInfo'])
    for (let attempt = 0; attempt < 3; attempt++) {
      let retryable = false
      try {
        let response
        try {
          response = await this.fetcher(ONLINE_LOOPBACK, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1952, method, params }), signal: AbortSignal.timeout(40_000), redirect: 'manual' })
        } catch (error) { retryable = true; throw error }
        retryable = response.status >= 500
        const body = await response.json()
        if (!response.ok || body.id !== 1952 || body.error) {
          const message = String(body.error?.message ?? response.status)
          retryable ||= !/execution reverted/i.test(message) && /failed to get (?:storage|account)|error sending request|SendRequest|TLS|connection|timeout|transport/i.test(message)
          throw new Error(`Owned 8955 ${method} failed: ${message}`)
        }
        return body.result
      } catch (error) {
        if (!reads.has(method) || !retryable || attempt === 2) throw error
        await this.wait(1000 * (attempt + 1))
      }
    }
    throw new Error('Owned fork read retries exhausted')
  }
  async start() {
    if (await this.rpc('eth_chainId') !== '0x7a0' || !/anvil/i.test(await this.rpc('web3_clientVersion'))) throw new Error('Owned 1952 Anvil required')
    const info = await this.rpc('anvil_nodeInfo')
    if (!info.forkConfig || BigInt(info.forkConfig.forkBlockNumber) !== BigInt(await this.rpc('eth_blockNumber'))) throw new Error('Fresh owned fork required; do not replay an advanced fork')
    if (fs.existsSync(this.output)) throw new Error('Frozen output already exists; never overwrite a reviewed plan')
    this.startNonce = BigInt(await this.rpc('eth_getTransactionCount', [ONLINE_OWNER, 'latest']))
    await this.rpc('anvil_impersonateAccount', [ONLINE_OWNER])
    this.localSnapshot = await this.rpc('evm_snapshot'); this.save()
  }
  save() {
    fs.writeFileSync(this.output, JSON.stringify({ schemaVersion: 1, phase: ONLINE_PHASE, chainId: 1952, localForkOnly: true,
      publicWrites: false, approval: 'draft_requires_new_user_approval', owner: this.owner, startNonce: String(this.startNonce),
      feeCapWei: String(this.feeCap), draft: this.draft, transactions: this.rows, result: this.result,
      sourceRoot: this.sourceRoot, artifactRoot: this.artifactRoot, localSnapshot: this.localSnapshot,
      totalGasUpperBound: this.totalGasUpperBound, totalFeeUpperBoundWei: this.totalFeeUpperBoundWei,
      actualLocalFeeWei: this.actualLocalFeeWei, rehearsalPassed: this.rehearsalPassed === true, failure: this.failure,
    }, null, 2) + '\n', { mode: 0o600 })
  }
  async mineAfterBlock(anchor) { while (BigInt(await this.rpc('eth_blockNumber')) <= anchor) await this.rpc('evm_mine') }
}
export async function simulateOnlineAssets({ root, artifactRoot, output, feeCapWei = 20_000_001n, keeper = null, fundingWei = 0n }) {
  const plan = new OnlineLoopbackPlan(output, feeCapWei)
  plan.sourceRoot = root; plan.artifactRoot = artifactRoot
  const frozenSources = JSON.stringify(onlineSources(root))
  await plan.start()
  try {
    await assertMiningFeeParameters(plan, 0n, 0n)
    plan.draft = await onlineSnapshot(plan, root, artifactRoot, keeper, fundingWei)
    if (plan.draft.startNonce !== String(plan.startNonce)) throw new Error('Pinned fork owner nonce changed')
    plan.save()
    await runOnlineAssets(plan, root, artifactRoot, plan.draft)
    for (const row of plan.rows) {
      const raw = serializeTransaction({ type: 'legacy', chainId: 1952, nonce: Number(row.nonce), to: row.to,
        gas: BigInt(row.gas), gasPrice: plan.feeCap, value: BigInt(row.value), data: row.data })
      row.signedSizeUpperBound = (raw.length - 2) / 2 + 72
      await assertMiningFeeParameters(plan, BigInt(row.signedSizeUpperBound), BigInt(row.gas))
    }
    plan.totalGasUpperBound = String(plan.rows.reduce((n, row) => n + BigInt(row.gas), 0n))
    plan.totalFeeUpperBoundWei = String(BigInt(plan.totalGasUpperBound) * plan.feeCap)
    plan.actualLocalFeeWei = String(plan.rows.reduce((n, row) => n + BigInt(row.gasUsed) * plan.feeCap, 0n))
    if (JSON.stringify(onlineSources(root)) !== frozenSources || JSON.stringify(plan.draft.sourceSha256) !== frozenSources) throw new Error('Online execution sources changed during rehearsal; use a fresh owned fork')
    plan.rehearsalPassed = plan.rows.length === (keeper ? 14 : 13) && plan.result.completed === true && plan.rows.every(row => row.status === '0x1')
    if (!plan.rehearsalPassed) throw new Error('Incomplete online assets rehearsal')
    plan.save()
    return { plan, sha256: fileSha(fs.readFileSync(output)) }
  } catch (e) { plan.failure = e instanceof Error ? e.message : 'Online rehearsal failed'; plan.save(); throw e }
}
if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1] }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const output = path.resolve(value('--output', path.join(root, '.analysis/mining-1952/online-assets/unsigned.json')))
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const { plan, sha256 } = await simulateOnlineAssets({ root, output,
    artifactRoot: path.resolve(value('--artifact-root', root)), keeper: value('--keeper', null), fundingWei: BigInt(value('--keeper-funding-wei', '0')),
    feeCapWei: BigInt(value('--fee-cap-wei', '20000001')) })
  console.log(JSON.stringify({ draftOnly: true, publicWrites: false, planSha256: sha256, transactions: plan.rows.length,
    startNonce: String(plan.startNonce), gasUpperBoundWei: plan.totalFeeUpperBoundWei, actualLocalFeeWei: plan.actualLocalFeeWei,
    lp: plan.draft.lp, keeperFundingWei: plan.draft.keeperFundingWei, miners: plan.result.miners, rehearsalPassed: plan.rehearsalPassed }))
}
