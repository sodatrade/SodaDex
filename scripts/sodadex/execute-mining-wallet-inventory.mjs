#!/usr/bin/env node
// Inventory preparation only. Business acceptance must use the public UI and OKX wallet.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PublicMiningExecution } from './mining-public-execution.mjs'
import { fileSha } from './mining-plan-artifacts.mjs'
import { ONLINE_OWNER, same, json } from './mining-online-assets.mjs'
import { INVENTORY_PHASE, INVENTORY_START_NONCE, INVENTORY_RECIPIENT, INVENTORY_FAB_RAW,
  inventorySnapshot, inventorySources, runWalletInventory } from './mining-wallet-inventory.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export function validateWalletInventoryApproval(rehearsal, bytes, approval, sources) {
  const budget = approval.approvedBudget
  if (approval.approved !== true || approval.phase !== 'mining-public-wallet-1952-v1' || approval.chainId !== 1952 ||
      !approval.approvalReference || !same(approval.owner, ONLINE_OWNER) || !same(approval.wallet, INVENTORY_RECIPIENT) ||
      rehearsal.phase !== INVENTORY_PHASE || rehearsal.chainId !== 1952 || rehearsal.localForkOnly !== true ||
      rehearsal.publicWrites !== false || rehearsal.signing !== false || rehearsal.rehearsalPassed !== true ||
      rehearsal.startNonce !== String(INVENTORY_START_NONCE) || !same(rehearsal.owner, ONLINE_OWNER) ||
      rehearsal.feeCapWei !== '20000001' || approval.rehearsal?.sha256 !== fileSha(bytes) ||
      JSON.stringify(rehearsal.draft?.sourceSha256) !== JSON.stringify(sources)) throw new Error('Exact approved 1952 inventory rehearsal required')
  if (!budget || budget.ownerPreparationGasCapWei !== '100000000000000' ||
      budget.totalNewGasCapWei !== '1300000000000000' || budget.fabPrincipalCapRaw !== String(INVENTORY_FAB_RAW) ||
      budget.browserWalletGasCapWei !== '1000000000000000' || budget.keeperAdditionalGasCapWei !== '200000000000000' ||
      budget.additionalNativeWalletFundingWei !== '0' || BigInt(rehearsal.totalFeeUpperBoundWei) > BigInt(budget.ownerPreparationGasCapWei))
    throw new Error('New inventory budget mismatch')
  const draft = rehearsal.draft
  if (draft.minerId !== '8' || draft.listingId !== '5' || draft.transferFabRaw !== String(INVENTORY_FAB_RAW) ||
      !same(draft.recipient, INVENTORY_RECIPIENT) || draft.nativePrincipalWei !== '0' || draft.keeperFundingWei !== '0' ||
      draft.extraLiquidityFabRaw !== '0' || rehearsal.transactions?.length !== 7 ||
      rehearsal.result?.completed !== true ||
      rehearsal.transactions.some((row, index) => row.status !== '0x1' || row.value !== '0' || BigInt(row.nonce) !== INVENTORY_START_NONCE + BigInt(index)))
    throw new Error('Inventory-only seven-call intent required')
  if (rehearsal.transactions.reduce((sum, row) => sum + BigInt(row.gas), 0n) * BigInt(rehearsal.feeCapWei) !== BigInt(rehearsal.totalFeeUpperBoundWei))
    throw new Error('Inventory fee reservation differs from exact rehearsal rows')
}

class PublicWalletInventory extends PublicMiningExecution {
  constructor(output, trial, bytes, approval, expectedHead) {
    super(ONLINE_OWNER, output, { ...trial, feeCap: trial.feeCapWei }, {},
      { phaseBudget: { gasWei: approval.approvedBudget.ownerPreparationGasCapWei } })
    Object.assign(this, { trial, bytes, approval, expectedHead })
  }
  save() {
    if (!this.journalOwned) throw new Error('Inventory journal is not owned')
    const saved = { schemaVersion: 1, phase: INVENTORY_PHASE, chainId: 1952, publicTestnet: true,
      productionTouched: false, chain196Touched: false, owner: this.owner, sourceHead: this.expectedHead,
      rehearsalSha256: fileSha(this.bytes), approvalSha256: fileSha(json(this.approval)),
      startNonce: String(this.startNonce), feeCapWei: String(this.feeCap), actualFeesWei: String(this.actualFees),
      transactions: this.rows, pending: this.pending ?? null, failure: this.failure,
      result: this.result ? { ...this.result, publicWrites: true, preparationOnly: true } : null }
    fs.writeFileSync(this.output + '.tmp', json(saved) + '\n', { mode: 0o600 })
    fs.renameSync(this.output + '.tmp', this.output)
  }
  async start() {
    validateWalletInventoryApproval(this.trial, this.bytes, this.approval, inventorySources(root))
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    if (!/^[0-9a-f]{40}$/.test(this.expectedHead ?? '') || git('rev-parse', 'HEAD') !== this.expectedHead ||
        git('branch', '--show-current') !== 'codex/feat/mining-products-1952' || git('status', '--porcelain') ||
        git('remote', 'get-url', 'origin') !== 'https://github.com/sodatrade/SodaDex.git' ||
        git('ls-remote', '--heads', 'origin', 'refs/heads/codex/feat/mining-products-1952').split(/\s/)[0] !== this.expectedHead)
      throw new Error('Exact clean published requirement branch required')
    if (fs.existsSync(this.output)) throw new Error('Existing inventory journal: inspect original hashes, never replay the prefix')
    if (await this.rpc('eth_chainId') !== '0x7a0' || /anvil|hardhat/i.test(await this.rpc('web3_clientVersion')))
      throw new Error('Public 1952 required')
    const snapshot = await inventorySnapshot(this, root, root)
    for (const key of ['minerId', 'listingId', 'recipient', 'sampleCount', 'listingPriceWei', 'transferFabRaw', 'reservedRetail'])
      if (snapshot[key] !== this.trial.draft[key]) throw new Error('Reviewed inventory boundary changed')
    this.startNonce = INVENTORY_START_NONCE
    if (BigInt(await this.rpc('eth_getTransactionCount', [this.owner, 'pending'])) !== this.startNonce)
      throw new Error('Owner pending nonce unresolved')
    await this.checkFeeModel(0n, 0n)
    this.proofAnchor = snapshot.roots.block
    fs.closeSync(fs.openSync(this.output, 'wx', 0o600)); this.journalOwned = true; this.save()
  }
  async send(label, to, data, value = 0n) {
    const previous = this.rows.at(-1)?.receipt
    const anchor = previous ? { number: previous.blockNumber, hash: previous.blockHash } : this.proofAnchor
    if ((await this.rpc('eth_getBlockByNumber', [anchor.number, false])).hash !== anchor.hash)
      throw new Error('Prior inventory proof changed; reconcile before any continuation')
    return super.send(label, to, data, value)
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1] }
  const bytes = fs.readFileSync(path.resolve(option('--plan', '.analysis/mining-1952/wallet-inventory/unsigned.json'))), trial = JSON.parse(bytes)
  if (!args.includes('--execute-wallet-inventory-1952')) {
    console.log(json({ signing: false, publicExecution: false, calls: trial.transactions.length, gasUpperBoundWei: trial.totalFeeUpperBoundWei }))
  } else {
    const approval = JSON.parse(fs.readFileSync(path.resolve(option('--approval', 'deployments/xlayer-1952/2026-10-18-public-wallet-plan.json'))))
    validateWalletInventoryApproval(trial, bytes, approval, inventorySources(root))
    const output = path.resolve(option('--journal', '.analysis/mining-1952/wallet-inventory/public-journal.json'))
    const sender = new PublicWalletInventory(output, trial, bytes, approval, option('--expected-head', null))
    try {
      await sender.start(); await runWalletInventory(sender, root, trial.draft)
      if (sender.rows.length !== 7 || !sender.result?.completed || sender.pending) throw new Error('Inventory preparation incomplete')
      sender.save(); console.log(json({ completed1952: true, preparationOnly: true, productionTouched: false,
        calls: sender.rows.length, actualGasWei: String(sender.actualFees), minerId: '8', listingId: '5', recipient: INVENTORY_RECIPIENT }))
    } catch (error) {
      sender.failure = error instanceof Error ? error.message : 'Inventory execution stopped'
      if (sender.journalOwned) sender.save()
      console.error(sender.failure); process.exitCode = 1
    }
  }
}
