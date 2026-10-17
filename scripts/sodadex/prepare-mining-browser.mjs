#!/usr/bin/env node
// Convert the explicit Foundry export to a loopback-only Anvil genesis and UI manifest.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { keccak256, toFunctionSelector } from 'viem'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2), online = args.includes('--online'), connected = args.includes('--connected')
const portIndex = args.indexOf('--port'), portText = portIndex < 0 ? String(online ? 8954 : 8952) : args[portIndex + 1]
if (args.some((arg, i) => !['--online', '--connected', '--port'].includes(arg) && !(portIndex >= 0 && i === portIndex + 1)) ||
    !/^[0-9]{4,5}$/.test(portText ?? '') || String(Number(portText)) !== portText || Number(portText) > 65535 || Number(portText) < 1024 ||
    (online && [8952, 8953].includes(Number(portText)))) throw new Error('Use an explicit isolated loopback port; existing 8952/8953 are reserved')
const rpcUrl = `http://127.0.0.1:${portText}`
const directory = path.join(root, '.analysis/mining-1952', online ? 'browser-online-fixture' : 'browser-fixture')
const addresses = JSON.parse(fs.readFileSync(path.join(directory, 'addresses.json'), 'utf8'))
const stateBytes = fs.readFileSync(path.join(directory, 'state.json'), 'utf8')
const state = JSON.parse(stateBytes)
if (online && (addresses.online !== true || addresses.feeModel !== 'loopback-zero-surcharges' ||
    !Number.isSafeInteger(addresses.farmListingId) || addresses.farmListingId === addresses.testListingId ||
    !Number.isSafeInteger(addresses.farmMinerId) || addresses.farmMinerId === addresses.retailMinerId ||
    addresses.farmMinerId === addresses.minerId || ['account', 'inventorySeller', 'keeper', 'publicSigner', 'transistors'].some((key) =>
      typeof addresses[key] !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(addresses[key])))) throw new Error('Separate online fixture inventory and fee infrastructure required')
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
  const response = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10_000) })
  const result = await response.json()
  if (result.error) throw new Error(result.error.message)
  return result.result
}
const timestamp = online ? Math.max(addresses.timestamp, Math.floor(Date.now() / 1000)) : addresses.timestamp
const genesis = { config: { chainId: 1952 }, timestamp: `0x${timestamp.toString(16)}`, gasLimit: '0x1c9c380', difficulty: '0x0', alloc: state }
if (!online || !connected) fs.writeFileSync(path.join(directory, 'genesis.json'), JSON.stringify(genesis))
if (connected) {
  if (await rpc('eth_chainId') !== '0x7a0') throw new Error('Wrong loopback chain')
  if (!String(await rpc('web3_clientVersion')).toLowerCase().startsWith('anvil')) throw new Error('Only the explicitly isolated Anvil fixture is allowed')
  const verified = [...roles.map((role) => contracts[role]), ...(online ? [
    identity('0x420000000000000000000000000000000000000f'), identity('0x4200000000000000000000000000000000000015'),
  ] : [])]
  await Promise.all(verified.map(async (target) => {
    if (keccak256(await rpc('eth_getCode', [target.address, 'latest'])) !== target.runtimeKeccak256) throw new Error(`Unexpected runtime ${target.address} on the selected loopback port`)
  }))
  const call = async (to, name) => {
    const raw = await rpc('eth_call', [{ to, data: toFunctionSelector(name) }, 'latest'])
    if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(raw)) throw new Error('Invalid address getter')
    return `0x${raw.slice(-40)}`
  }
  const beacon = await call(addresses.nftFactory, 'circuitBeacon()')
  contracts.circuits.beacon = { ...identity(beacon), implementation: identity(await call(beacon, 'implementation()')) }
  const p = Object.fromEntries(['token', 'vault', 'holder', 'pair'].map((role) => [role, identity(addresses[`project${role[0].toUpperCase()}${role.slice(1)}`])]))
  const manifest = { schemaVersion: 1, chainId: 1952, state: 'ready', sourceHistoryVersion: 2,
    version: `loopback-${online ? 'online-' : ''}v2-${keccak256(new TextEncoder().encode(stateBytes)).slice(2, 18)}`, genesisBlock: '0',
    templateId: addresses.templateId, contracts, projects: [{ ...p, symbol: 'TEST-A' }], testListingIds: [String(addresses.testListingId)] }
  fs.writeFileSync(path.join(directory, 'products.json'), JSON.stringify(manifest, null, 2) + '\n')
  await rpc('anvil_impersonateAccount', [addresses.account])
  console.log(JSON.stringify({ localOnly: true, broadcast: false, online, rpcUrl, account: addresses.account, minerId: addresses.minerId,
    ...(online ? { farmListingId: addresses.farmListingId, retailListingId: addresses.testListingId, feeModel: addresses.feeModel } : {}) }))
} else console.log(JSON.stringify({ localOnly: true, broadcast: false, online, rpcUrl, genesis: path.join(directory, 'genesis.json') }))
