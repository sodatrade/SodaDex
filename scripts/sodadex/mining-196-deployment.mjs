import { keccak256 } from 'viem'

/** Local receipt identities only; never an active/public deployment record. */
export async function mining196LocalDeployment(plan) {
  const s = plan.stack, b = plan.business
  if (!b?.completed || !s) throw new Error('Complete business rehearsal required')
  const identity = async (address) => {
    const code = await plan.rpc('eth_getCode', [address, 'latest'])
    if (code === '0x') throw new Error('Missing local contract code')
    return { address, runtimeKeccak256: keccak256(code) }
  }
  const roles = { fab: s.fab, mining: s.mining, circuits: s.circuits, circuitMarket: s.circuitMarket,
    nftFactory: s.nftFactory, manager: s.manager, launchFactory: s.launchFactory, registry: s.registry,
    miningFactory: s.miningFactory, farm: s.farm, router: s.router, v2Factory: s.v2Factory,
    wrappedNative: s.wrapped, v2Locker: s.v2Locker, liquidityHelper: s.helper,
    fragmentVault: s.fragmentVault, fragmentPool: s.fragmentPool, minerBuyer: s.minerBuyer }
  const contracts = {}
  for (const [role, address] of Object.entries(roles)) contracts[role] = await identity(address)
  for (const [role, implementation] of [['mining', s.miningImplementation], ['manager', s.managerImplementation],
    ['nftFactory', s.factoryImplementation], ['circuitMarket', s.marketImplementation]]) {
    const word = await plan.rpc('eth_getStorageAt', [roles[role], '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc', 'latest'])
    if (word.slice(-40).toLowerCase() !== implementation.slice(2).toLowerCase()) throw new Error('Local proxy implementation drift')
    contracts[role].implementation = await identity(implementation)
  }
  const beacon = await plan.call(s.nftFactory, 'function circuitBeacon() view returns(address)')
  contracts.circuits.beacon = { ...await identity(beacon), implementation: await identity(await plan.call(beacon, 'function implementation() view returns(address)')) }
  const receipt = await plan.rpc('eth_getTransactionReceipt', [plan.rows[0].hash])
  return { schemaVersion: 1, chainId: 196, profileId: '196-mining-test', state: 'ready', sourceHistoryVersion: 2,
    version: `local-196-${plan.fork.block}-${plan.rows.length}`, genesisBlock: String(BigInt(receipt.blockNumber)), templateId: 0,
    contracts, projects: [{ token: await identity(b.token), vault: await identity(b.vault), holder: await identity(b.holder), pair: await identity(b.pair), symbol: 'TEST-A' }],
    testListingIds: b.retailListingIds, localOnly: true, publicDeployment: false, productionTouched: false }
}
