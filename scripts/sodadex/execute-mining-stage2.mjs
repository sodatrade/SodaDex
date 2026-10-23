#!/usr/bin/env node
// Explicit public TESTNET executor. Default invocation performs no signing or broadcast.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { keccak256 } from 'viem'
import { PublicMiningExecution } from './mining-public-execution.mjs'
import { prepareMiningStack } from './mining-plan-stack.mjs'
import { prepareMiningNfts } from './mining-plan-nfts.mjs'
import { exerciseMiningProducts } from './mining-plan-business.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const folder = path.join(root, '.analysis/mining-1952/stage2-plan')
const bytes = fs.readFileSync(path.join(folder, 'unsigned.json'))
const rehearsal = JSON.parse(bytes), policy = JSON.parse(fs.readFileSync(path.join(root, 'deployments/xlayer-1952/test-policy.json')))
const signer = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.local/share/sodadex/wallets/xlayer-1952-mining-authorizer/public.json')))
if (!process.argv.includes('--execute-1952')) {
  console.log(JSON.stringify({ publicExecution: false, transactions: rehearsal.transactions.length,
    completeLocalRehearsal: rehearsal.business?.completed === true, budgetPassed: rehearsal.budgetPassed === true,
    feeUpperBoundWei: rehearsal.totalFeeUpperBound ?? null, phaseLimitWei: policy.phaseBudget.gasWei }))
  process.exit(0)
}
const delivery = JSON.parse(fs.readFileSync(path.join(folder, 'public-delivery.json')))
if (delivery.rehearsalSha256 !== createHash('sha256').update(bytes).digest('hex') || signer.chainId !== 1952 ||
  signer.address.toLowerCase() !== rehearsal.stack.signer.toLowerCase() || policy.chainId !== 1952) throw new Error('Reviewed rehearsal or test signer changed')
const plan = new PublicMiningExecution(rehearsal.owner, path.join(folder, 'public-journal.json'), rehearsal, delivery, policy)
try {
  await plan.start()
  const stack = await prepareMiningStack(plan, root, signer.address)
  await prepareMiningNfts(plan, root, stack)
  await exerciseMiningProducts(plan, root, stack)
  if (plan.rows.length !== rehearsal.transactions.length || plan.business?.completed !== true) throw new Error('Public acceptance is incomplete')
  const identity = async (address) => {
    const code = await plan.rpc('eth_getCode', [address, 'latest'])
    if (code === '0x') throw new Error('No code at a product dependency')
    return { address, runtimeKeccak256: keccak256(code) }
  }
  const aliases = { wrappedNative: 'wrapped', liquidityHelper: 'helper' }
  const roles = ['fab', 'mining', 'circuits', 'circuitMarket', 'nftFactory', 'manager', 'launchFactory', 'registry',
    'miningFactory', 'farm', 'router', 'v2Factory', 'wrappedNative', 'v2Locker', 'liquidityHelper', 'fragmentVault', 'fragmentPool', 'minerBuyer']
  const contracts = {}
  for (const role of roles) contracts[role] = await identity(stack[aliases[role] ?? role])
  for (const role of ['mining', 'manager', 'nftFactory', 'circuitMarket']) {
    const slot = await plan.rpc('eth_getStorageAt', [contracts[role].address, '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc', 'latest'])
    if (!/^0x0{24}[a-fA-F0-9]{40}$/.test(slot)) throw new Error('Invalid product proxy implementation')
    contracts[role].implementation = await identity(`0x${slot.slice(-40)}`)
  }
  const beacon = await plan.call(stack.nftFactory, 'function circuitBeacon() view returns(address)')
  contracts.circuits.beacon = { ...await identity(beacon), implementation: await identity(await plan.call(beacon, 'function implementation() view returns(address)')) }
  const project = { symbol: 'TEST-A' }
  for (const key of ['token', 'vault', 'holder', 'pair']) project[key] = await identity(plan.business[key])
  const manifest = { schemaVersion: 1, chainId: 1952, state: 'ready', version: `phase2-${delivery.repositories[0].head.slice(0, 12)}-${BigInt(plan.rows.at(-1).blockNumber)}`,
    genesisBlock: String(BigInt(plan.rows[0].blockNumber)), sourceHistoryVersion: 2, templateId: 0, contracts, projects: [project], testListingIds: plan.business.retailListingIds }
  fs.writeFileSync(path.join(root, 'deployments/xlayer-1952/products.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(JSON.stringify({ deployed1952: true, productionTouched: false, actualGasFeeWei: String(plan.actualFees), addresses: manifest }))
} catch (error) {
  plan.failure = error instanceof Error ? error.message : 'Public test execution stopped'
  if (plan.journalOwned) plan.save()
  console.error(plan.failure.slice(0, 400))
  process.exitCode = 1
}
