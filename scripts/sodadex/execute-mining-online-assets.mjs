#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PublicOnlineAssets, reconcileOnlineJournal, validateOnlineApproval } from './mining-online-assets-public.mjs'
import { runOnlineAssets } from './mining-online-assets.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2), option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1] }
const folder = path.join(root, '.analysis/mining-1952/online-assets')
const planFile = path.resolve(option('--plan', path.join(folder, 'unsigned.json')))
const bytes = fs.readFileSync(planFile), rehearsal = JSON.parse(bytes)
if (!args.includes('--execute-online-assets-1952') && !args.includes('--reconcile-only')) {
  console.log(JSON.stringify({ publicExecution: false, signing: false, newApprovalRequired: true,
    rehearsalPassed: rehearsal.rehearsalPassed === true, transactions: rehearsal.transactions.length,
    gasUpperBoundWei: rehearsal.totalFeeUpperBoundWei, liquidity: rehearsal.draft.lp, keeperFundingWei: rehearsal.draft.keeperFundingWei }))
  process.exit(0)
}
if (args.includes('--execute-online-assets-1952') && args.includes('--reconcile-only')) throw new Error('Choose execution or read-only reconciliation, never both')
const policy = JSON.parse(fs.readFileSync(path.resolve(option('--policy', path.join(folder, 'approved-policy.json')))))
const delivery = JSON.parse(fs.readFileSync(path.resolve(option('--delivery', path.join(folder, 'approved-delivery.json')))))
const output = path.resolve(option('--journal', path.join(folder, 'public-journal.json')))
const runner = new PublicOnlineAssets({ root, artifactRoot: path.resolve(option('--artifact-root', root)), output, rehearsal, bytes, policy, delivery })
try {
  if (args.includes('--reconcile-only')) {
    validateOnlineApproval(rehearsal, bytes, policy, delivery)
    if (await runner.rpc('eth_chainId') !== '0x7a0') throw new Error('1952 reconciliation only')
    const saved = JSON.parse(fs.readFileSync(output))
    if (saved.phase !== rehearsal.phase || saved.planSha256 !== delivery.planSha256 || saved.owner.toLowerCase() !== runner.owner.toLowerCase()) throw new Error('Journal plan/owner mismatch')
    runner.rows = saved.transactions; runner.pending = saved.pending ?? undefined; runner.actualFees = BigInt(saved.actualFeesWei); runner.owned = true
    console.log(JSON.stringify(await reconcileOnlineJournal(runner)))
  } else {
    await runner.start(); await runOnlineAssets(runner, root, runner.artifactRoot, rehearsal.draft)
    if (runner.rows.length !== rehearsal.transactions.length || !runner.result?.completed) throw new Error('Online asset preparation incomplete')
    console.log(JSON.stringify({ completed1952: true, productionTouched: false, transactions: runner.rows.length,
      actualGasFeeWei: String(runner.actualFees), miners: runner.result.miners, lpRecipient: runner.result.lpRecipient }))
  }
} catch (e) {
  runner.failure = e instanceof Error ? e.message : 'Online assets stopped'
  if (runner.owned) runner.save()
  console.error(runner.failure); process.exitCode = 1
}
