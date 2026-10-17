import fs from 'node:fs'
import path from 'node:path'
import { keccak256 } from 'viem'

// Same postconditions as the frozen executor, used after its recovered pipeline.
export async function saveRecoveredMiningManifest(plan, root, delivery) {
  if (plan.rows.length !== 102 || plan.business?.completed !== true || plan.pending || plan.failure)
    throw new Error('Recovered public acceptance is incomplete')
  const identity = async (address) => {
    const code = await plan.rpc('eth_getCode', [address, 'latest'])
    if (code === '0x') throw new Error('No code at a product dependency')
    return { address, runtimeKeccak256: keccak256(code) }
  }
  const aliases = { wrappedNative: 'wrapped', liquidityHelper: 'helper' }
  const roles = ['fab', 'mining', 'circuits', 'circuitMarket', 'nftFactory', 'manager', 'launchFactory', 'registry',
    'miningFactory', 'farm', 'router', 'v2Factory', 'wrappedNative', 'v2Locker', 'liquidityHelper', 'fragmentVault', 'fragmentPool', 'minerBuyer']
  const contracts = {}
  for (const role of roles) contracts[role] = await identity(plan.stack[aliases[role] ?? role])
  for (const role of ['mining', 'manager', 'nftFactory', 'circuitMarket']) {
    const slot = await plan.rpc('eth_getStorageAt', [contracts[role].address, '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc', 'latest'])
    if (!/^0x0{24}[a-fA-F0-9]{40}$/.test(slot)) throw new Error('Invalid product proxy implementation')
    contracts[role].implementation = await identity(`0x${slot.slice(-40)}`)
  }
  const beacon = await plan.call(plan.stack.nftFactory, 'function circuitBeacon() view returns(address)')
  contracts.circuits.beacon = { ...await identity(beacon), implementation: await identity(await plan.call(beacon, 'function implementation() view returns(address)')) }
  const project = { symbol: 'TEST-A' }
  for (const key of ['token', 'vault', 'holder', 'pair']) project[key] = await identity(plan.business[key])
  const manifest = { schemaVersion: 1, chainId: 1952, state: 'ready', version: `phase2-${delivery.repositories[0].head.slice(0, 12)}-${BigInt(plan.rows.at(-1).blockNumber)}`,
    genesisBlock: String(BigInt(plan.rows[0].blockNumber)), sourceHistoryVersion: 2, templateId: 0, contracts, projects: [project], testListingIds: plan.business.retailListingIds }
  fs.writeFileSync(path.join(root, 'deployments/xlayer-1952/products.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}
