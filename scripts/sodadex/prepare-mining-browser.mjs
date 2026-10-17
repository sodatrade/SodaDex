#!/usr/bin/env node
// Convert the explicit Foundry export to a loopback-only Anvil genesis and UI manifest.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { keccak256, toFunctionSelector } from 'viem'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const directory = path.join(root, '.analysis/mining-1952/browser-fixture')
const addresses = JSON.parse(fs.readFileSync(path.join(directory, 'addresses.json'), 'utf8'))
const stateBytes = fs.readFileSync(path.join(directory, 'state.json'), 'utf8')
const state = JSON.parse(stateBytes)
const slot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
const roles = ['fab', 'mining', 'circuits', 'circuitMarket', 'nftFactory', 'manager', 'launchFactory', 'registry',
  'miningFactory', 'farm', 'router', 'v2Factory', 'wrappedNative', 'v2Locker', 'liquidityHelper', 'fragmentVault', 'fragmentPool', 'minerBuyer']
function identity(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? '')) throw new Error('Missing exported address')
  const account = state[address.toLowerCase()]
  if (!account || !/^0x[0-9a-fA-F]+$/.test(account.code) || account.code === '0x') throw new Error('Missing genuine contract code')
  return { address, runtimeKeccak256: keccak256(account.code) }
}
const contracts = Object.fromEntries(roles.map((role) => [role, identity(addresses[role])]))
for (const role of ['mining', 'manager', 'circuitMarket', 'nftFactory']) {
  const word = state[addresses[role].toLowerCase()].storage[slot]
  if (!word || !/^0x0{24}[0-9a-fA-F]{40}$/.test(word)) throw new Error(`Missing ${role} implementation`)
  contracts[role].implementation = identity(`0x${word.slice(-40)}`)
}
const rpc = async (method, params = []) => {
  const response = await fetch('http://127.0.0.1:8952', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const result = await response.json()
  if (result.error) throw new Error(result.error.message)
  return result.result
}
const genesis = { config: { chainId: 1952 }, timestamp: `0x${addresses.timestamp.toString(16)}`, gasLimit: '0x1c9c380', difficulty: '0x0', alloc: state }
fs.writeFileSync(path.join(directory, 'genesis.json'), JSON.stringify(genesis))
if (process.argv.includes('--connected')) {
  if (await rpc('eth_chainId') !== '0x7a0') throw new Error('Wrong loopback chain')
  const call = async (to, name) => {
    const raw = await rpc('eth_call', [{ to, data: toFunctionSelector(name) }, 'latest'])
    if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(raw)) throw new Error('Invalid address getter')
    return `0x${raw.slice(-40)}`
  }
  const beacon = await call(addresses.nftFactory, 'circuitBeacon()')
  contracts.circuits.beacon = { ...identity(beacon), implementation: identity(await call(beacon, 'implementation()')) }
  const p = Object.fromEntries(['token', 'vault', 'holder', 'pair'].map((role) => [role, identity(addresses[`project${role[0].toUpperCase()}${role.slice(1)}`])]))
  const manifest = { schemaVersion: 1, chainId: 1952, state: 'ready', sourceHistoryVersion: 2,
    version: `loopback-v2-${keccak256(new TextEncoder().encode(stateBytes)).slice(2, 18)}`, genesisBlock: '0',
    templateId: addresses.templateId, contracts, projects: [{ ...p, symbol: 'TEST-A' }], testListingIds: [String(addresses.testListingId)] }
  fs.writeFileSync(path.join(directory, 'products.json'), JSON.stringify(manifest, null, 2) + '\n')
  await rpc('anvil_impersonateAccount', [addresses.account])
  console.log(JSON.stringify({ localOnly: true, broadcast: false, account: addresses.account, minerId: addresses.minerId }))
} else console.log(JSON.stringify({ localOnly: true, broadcast: false, genesis: path.join(directory, 'genesis.json') }))
