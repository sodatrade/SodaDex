#!/usr/bin/env node
// This program can send ONLY to the hard-coded loopback Anvil fork. It cannot broadcast publicly.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serializeTransaction } from 'viem'
import { LoopbackMiningPlan } from './mining-plan-rpc.mjs'
import { prepareMiningStack } from './mining-plan-stack.mjs'
import { prepareMiningNfts } from './mining-plan-nfts.mjs'
import { exerciseMiningProducts } from './mining-plan-business.mjs'
import { miningExecutionSources } from './mining-reviewed-intent.mjs'
import { assertMiningFeeParameters } from './mining-fee-model.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const directory = path.join(root, '.analysis/mining-1952/stage2-plan')
fs.mkdirSync(directory, { recursive: true })
const output = path.join(directory, 'unsigned.json')
const quote = JSON.parse(fs.readFileSync('/tmp/sodadex-mining-fork-quote.json', 'utf8'))
const publicSigner = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.local/share/sodadex/wallets/xlayer-1952-mining-authorizer/public.json'), 'utf8'))
const policy = JSON.parse(fs.readFileSync(path.join(root, 'deployments/xlayer-1952/test-policy.json'), 'utf8'))
if (quote.chainId !== 1952 || publicSigner.chainId !== 1952 || policy.chainId !== 1952) throw new Error('1952 configuration required')
const owner = '0x6ecf746b078d46391f8C425B150153212F7C0545'
const plan = new LoopbackMiningPlan(owner, output, quote.gasPrice)
plan.executionSourceSha256 = miningExecutionSources(root)
if (process.argv.includes('--reset')) {
  const saved = JSON.parse(fs.readFileSync(output, 'utf8'))
  if (!saved.localForkOnly || !saved.localSnapshot || !await plan.rpc('evm_revert', [saved.localSnapshot])) throw new Error('Saved fork snapshot is unavailable')
}
if (process.argv.includes('--resume')) await plan.resume(JSON.parse(fs.readFileSync(output, 'utf8')))
else {
  await plan.start()
  plan.localSnapshot = await plan.rpc('evm_snapshot')
  plan.save()
}
try {
  // Anvil's recommended gas price includes a development tip. Signed execution
  // uses the pinned public quote; fee-parameter ABI checks are shared verbatim.
  await assertMiningFeeParameters(plan, 0n, 0n)
  const stack = plan.stack ?? await prepareMiningStack(plan, root, publicSigner.address)
  if (process.argv.includes('--with-miners') && !plan.miners) await prepareMiningNfts(plan, root, stack)
  if (process.argv.includes('--with-business')) {
    const snapshot = await plan.rpc('evm_snapshot'), rowCount = plan.rows.length
    plan.preBusinessSnapshot = snapshot; plan.save()
    try { await exerciseMiningProducts(plan, root, stack) }
    catch (error) {
      if (!await plan.rpc('evm_revert', [snapshot])) throw new Error('Local business rollback failed')
      plan.rows.length = rowCount; plan.business = undefined; plan.businessPrincipal = undefined
      throw error
    }
  }
  const oracle = '0x420000000000000000000000000000000000000f'
  let maxBytes = 0n, maxGas = 0n
  for (const row of plan.rows) {
    const unsigned = serializeTransaction({ type: 'legacy', chainId: 1952, nonce: Number(row.nonce), gas: BigInt(row.gas),
      gasPrice: plan.feeCap, ...(row.to ? { to: row.to } : {}), value: BigInt(row.value), data: row.data })
    row.signedSizeUpperBound = (unsigned.length - 2) / 2 + 72
    maxBytes = maxBytes > BigInt(row.signedSizeUpperBound) ? maxBytes : BigInt(row.signedSizeUpperBound)
    maxGas = maxGas > BigInt(row.gas) ? maxGas : BigInt(row.gas)
  }
  if (await plan.call(oracle, 'function isFjord() view returns(bool)') !== true ||
      await plan.call(oracle, 'function isIsthmus() view returns(bool)') !== true) throw new Error('Unverified additional-fee model')
  await assertMiningFeeParameters(plan, maxBytes, maxGas)
  const l1 = await plan.call(oracle, 'function getL1FeeUpperBound(uint256) view returns(uint256)', [maxBytes])
  const operator = await plan.call(oracle, 'function getOperatorFee(uint256) view returns(uint256)', [maxGas])
  plan.additionalFeeUpperBound = String((l1 + operator) * BigInt(plan.rows.length))
  const execution = plan.rows.reduce((sum, row) => sum + BigInt(row.gas) * plan.feeCap, 0n)
  plan.totalFeeUpperBound = String(execution + BigInt(plan.additionalFeeUpperBound))
  plan.budgetPassed = BigInt(plan.totalFeeUpperBound) <= BigInt(policy.phaseBudget.gasWei)
  plan.save()
  console.log(JSON.stringify({ localOnly: true, broadcast: false, transactions: plan.rows.length, estimatedFeeUpperBound: plan.totalFeeUpperBound,
    additionalFeeUpperBound: plan.additionalFeeUpperBound, budgetPassed: plan.budgetPassed, businessTransactionsIncluded: plan.business?.completed === true }))
} catch (error) {
  plan.failure = error instanceof Error ? error.message : 'Unknown simulation error'
  plan.save()
  console.error(`Local rehearsal stopped: ${plan.failure.slice(0, 400)}`)
  process.exitCode = 1
}
