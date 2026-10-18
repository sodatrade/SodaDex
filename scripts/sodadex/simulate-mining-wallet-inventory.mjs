#!/usr/bin/env node
// Only an owned, fresh Anvil1952 fork at literal loopback8956 can receive writes.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serializeTransaction } from 'viem'
import { LoopbackMiningPlan } from './mining-plan-rpc.mjs'
import { ONLINE_OWNER } from './mining-online-assets.mjs'
import { assertMiningFeeParameters } from './mining-fee-model.mjs'
import { fileSha } from './mining-plan-artifacts.mjs'
import { INVENTORY_PHASE, INVENTORY_START_NONCE, inventorySnapshot, inventorySources, runWalletInventory } from './mining-wallet-inventory.mjs'

export const INVENTORY_LOOPBACK = 'http://127.0.0.1:8956'
const READS = new Set(['eth_chainId', 'web3_clientVersion', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode',
  'eth_getStorageAt', 'eth_getTransactionCount', 'eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_getBalance',
  'eth_getTransactionReceipt', 'anvil_nodeInfo'])
const WRITES = new Set(['anvil_impersonateAccount', 'evm_snapshot', 'evm_mine', 'eth_sendTransaction'])

export class InventoryLoopbackPlan extends LoopbackMiningPlan {
  constructor(output, feeCap, fetcher = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    super(ONLINE_OWNER, output, feeCap, fetcher); this.wait = wait
  }
  async rpc(method, params = []) {
    if (!READS.has(method) && !WRITES.has(method)) throw new Error('Inventory RPC method not allowed')
    if (WRITES.has(method) && !this.ownedForkVerified) throw new Error('Inventory fork ownership not verified')
    for (let attempt = 0; attempt < 3; attempt++) {
      let retryable = false
      try {
        let response
        try { response = await this.fetcher(INVENTORY_LOOPBACK, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1952, method, params }), signal: AbortSignal.timeout(40_000), redirect: 'manual' }) }
        catch (error) { retryable = true; throw error }
        retryable = response.status >= 500
        const body = await response.json()
        if (!response.ok || body.id !== 1952 || body.jsonrpc !== '2.0' || body.error) {
          const message = String(body.error?.message ?? response.status)
          retryable ||= !/execution reverted/i.test(message) && /failed to get (?:storage|account)|error sending request|SendRequest|TLS|connection|timeout|transport/i.test(message)
          throw new Error(`Owned8956 ${method} failed: ${message}`)
        }
        return body.result
      } catch (error) {
        if (!READS.has(method) || !retryable || attempt === 2) throw error
        await this.wait(1000 * (attempt + 1))
      }
    }
    throw new Error('Owned inventory fork reads exhausted')
  }
  async start() {
    if (await this.rpc('eth_chainId') !== '0x7a0' || !/anvil/i.test(await this.rpc('web3_clientVersion'))) throw new Error('Owned Anvil1952 required')
    const info = await this.rpc('anvil_nodeInfo'), latest = BigInt(await this.rpc('eth_blockNumber'))
    if (!info.forkConfig || BigInt(info.forkConfig.forkBlockNumber) !== latest) throw new Error('Fresh inventory fork required; never replay an advanced fork')
    this.startNonce = BigInt(await this.rpc('eth_getTransactionCount', [ONLINE_OWNER, 'latest']))
    if (this.startNonce !== INVENTORY_START_NONCE) throw new Error('Inventory owner nonce must remain143')
    if (fs.existsSync(this.output)) throw new Error('Frozen inventory output exists')
    this.forkBlockNumber = String(latest); this.ownedForkVerified = true
    await this.rpc('anvil_impersonateAccount', [ONLINE_OWNER])
    this.localSnapshot = await this.rpc('evm_snapshot'); this.save()
  }
  async mineAfterBlock(anchor) { while (BigInt(await this.rpc('eth_blockNumber')) <= anchor) await this.rpc('evm_mine') }
  save() {
    fs.writeFileSync(this.output, JSON.stringify({ schemaVersion: 1, phase: INVENTORY_PHASE, chainId: 1952,
      localForkOnly: true, publicWrites: false, signing: false, approval: 'draft_requires_new_bounded_phase_approval',
      owner: this.owner, startNonce: String(this.startNonce), feeCapWei: String(this.feeCap), forkBlockNumber: this.forkBlockNumber,
      localSnapshot: this.localSnapshot, sourceRoot: this.sourceRoot, artifactRoot: this.artifactRoot, draft: this.draft,
      transactions: this.rows, result: this.result, failure: this.failure, totalGasUpperBound: this.totalGasUpperBound,
      totalFeeUpperBoundWei: this.totalFeeUpperBoundWei, actualLocalFeeWei: this.actualLocalFeeWei,
      rehearsalPassed: this.rehearsalPassed === true }, (_, value) => typeof value === 'bigint' ? String(value) : value, 2) + '\n', { mode: 0o600 })
  }
}

export async function simulateWalletInventory({ root, artifactRoot, output, feeCapWei = 20_000_001n }) {
  const plan = new InventoryLoopbackPlan(output, feeCapWei), frozen = JSON.stringify(inventorySources(root))
  plan.sourceRoot = root; plan.artifactRoot = artifactRoot
  await plan.start()
  try {
    await assertMiningFeeParameters(plan, 0n, 0n)
    plan.draft = await inventorySnapshot(plan, root, artifactRoot)
    plan.save(); await runWalletInventory(plan, artifactRoot, plan.draft)
    for (const row of plan.rows) {
      const raw = serializeTransaction({ type: 'legacy', chainId: 1952, nonce: Number(row.nonce), to: row.to,
        gas: BigInt(row.gas), gasPrice: plan.feeCap, value: BigInt(row.value), data: row.data })
      row.signedSizeUpperBound = (raw.length - 2) / 2 + 72
      await assertMiningFeeParameters(plan, BigInt(row.signedSizeUpperBound), BigInt(row.gas))
    }
    if (frozen !== JSON.stringify(inventorySources(root)) || frozen !== JSON.stringify(plan.draft.sourceSha256)) throw new Error('Inventory sources changed during rehearsal')
    plan.totalGasUpperBound = String(plan.rows.reduce((sum, row) => sum + BigInt(row.gas), 0n))
    plan.totalFeeUpperBoundWei = String(BigInt(plan.totalGasUpperBound) * plan.feeCap)
    plan.actualLocalFeeWei = String(plan.rows.reduce((sum, row) => sum + BigInt(row.gasUsed) * plan.feeCap, 0n))
    plan.rehearsalPassed = plan.rows.length === 7 && plan.rows.every((row, i) => row.status === '0x1' && row.value === '0' &&
      BigInt(row.nonce) === INVENTORY_START_NONCE + BigInt(i)) && plan.result.completed
    if (!plan.rehearsalPassed) throw new Error('Inventory preparation incomplete')
    plan.save(); return { plan, sha256: fileSha(fs.readFileSync(output)) }
  } catch (error) { plan.failure = error instanceof Error ? error.message : 'Inventory rehearsal stopped'; plan.save(); throw error }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const output = path.resolve(option('--output', path.join(root, '.analysis/mining-1952/wallet-inventory/unsigned.json')))
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const { plan, sha256 } = await simulateWalletInventory({ root, artifactRoot: path.resolve(option('--artifact-root', root)), output,
    feeCapWei: BigInt(option('--fee-cap-wei', '20000001')) })
  console.log(JSON.stringify({ draftOnly: true, publicWrites: false, signing: false, phase: INVENTORY_PHASE,
    planSha256: sha256, transactions: plan.rows.length, startNonce: String(plan.startNonce),
    gasUpperBoundWei: plan.totalFeeUpperBoundWei, actualLocalFeeWei: plan.actualLocalFeeWei, result: plan.result,
    nativePrincipalWei: '0', fabPrincipalRaw: plan.draft.transferFabRaw, rehearsalPassed: plan.rehearsalPassed }))
}
