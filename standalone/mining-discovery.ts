import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, type Abi, type Hex } from 'viem'
import { IMPLEMENTATION_SLOT, miningTargets, sameMiningAddress } from './mining-calls'
import type { MiningAddress, MiningContractIdentity, MiningProductDeployment, MiningProject } from './mining-products'
import { MINING_LAUNCH_TEST_POLICY } from './mining-signed-calls'

export interface MiningDiscoveryRpc { request(method: string, params?: unknown[]): Promise<unknown> }
export interface MiningDiscoveryBlock { number: string; hash: string; timestamp: bigint }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const address = (v: unknown): v is MiningAddress => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/.test(v)
const hex = (v: unknown): v is Hex => typeof v === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(v)
const eq = (a: unknown, b: unknown): boolean => typeof a === 'string' && typeof b === 'string' ? sameMiningAddress(a, b) : a === b

export async function miningDiscoveryRead(rpc: MiningDiscoveryRpc, to: MiningAddress, signature: string,
  args: readonly unknown[] = [], block = 'latest'): Promise<unknown> {
  const abi = parseAbi([signature]) as Abi, item = abi[0]
  if (!item || item.type !== 'function') throw new Error('mining_discovery_invalid_getter')
  const name = item.name
  const data = encodeFunctionData({ abi, functionName: name, args })
  const result = await rpc.request('eth_call', [{ to, data }, block])
  if (!hex(result)) throw new Error('mining_discovery_invalid_rpc')
  return decodeFunctionResult({ abi, functionName: name, data: result })
}

async function snapshot(rpc: MiningDiscoveryRpc, block = 'latest'): Promise<MiningDiscoveryBlock> {
  const value = await rpc.request('eth_getBlockByNumber', [block, false])
  if (!record(value) || typeof value.number !== 'string' || !/^0x[0-9a-f]+$/i.test(value.number) ||
      typeof value.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value.hash) ||
      typeof value.timestamp !== 'string' || !/^0x[0-9a-f]+$/i.test(value.timestamp)) throw new Error('mining_discovery_invalid_block')
  if (/^0x[0-9a-f]+$/i.test(block) && BigInt(value.number) !== BigInt(block)) throw new Error('mining_discovery_wrong_block')
  return { number: value.number, hash: value.hash, timestamp: BigInt(value.timestamp) }
}
async function canonical(rpc: MiningDiscoveryRpc, block: MiningDiscoveryBlock): Promise<void> {
  if ((await snapshot(rpc, block.number)).hash.toLowerCase() !== block.hash.toLowerCase()) throw new Error('mining_discovery_reorg')
}
async function identity(rpc: MiningDiscoveryRpc, to: MiningAddress, block: string): Promise<MiningContractIdentity> {
  const code = await rpc.request('eth_getCode', [to, block])
  if (!hex(code)) throw new Error('mining_discovery_no_code')
  return { address: to, runtimeKeccak256: keccak256(code) }
}
async function matchIdentity(rpc: MiningDiscoveryRpc, expected: MiningContractIdentity, block: string): Promise<void> {
  if ((await identity(rpc, expected.address, block)).runtimeKeccak256.toLowerCase() !== expected.runtimeKeccak256.toLowerCase()) throw new Error('mining_discovery_runtime_changed')
  if (expected.implementation) {
    const slot = await rpc.request('eth_getStorageAt', [expected.address, IMPLEMENTATION_SLOT, block])
    if (typeof slot !== 'string' || !/^0x0{24}[0-9a-fA-F]{40}$/.test(slot) ||
        !sameMiningAddress(`0x${slot.slice(-40)}`, expected.implementation.address)) throw new Error('mining_discovery_implementation_changed')
    await matchIdentity(rpc, expected.implementation, block)
  }
  if (expected.beacon) {
    await Promise.all([matchIdentity(rpc, { address: expected.beacon.address, runtimeKeccak256: expected.beacon.runtimeKeccak256 }, block),
      matchIdentity(rpc, expected.beacon.implementation, block)])
    const implementation = await miningDiscoveryRead(rpc, expected.beacon.address, 'function implementation() view returns(address)', [], block)
    if (!eq(implementation, expected.beacon.implementation.address)) throw new Error('mining_discovery_beacon_changed')
  }
}
type Binding = [MiningAddress, string, readonly unknown[], unknown]
async function bindings(rpc: MiningDiscoveryRpc, values: Binding[], block: string): Promise<void> {
  await Promise.all(values.map(async ([to, signature, args, expected]) => {
    if (!eq(await miningDiscoveryRead(rpc, to, signature, args, block), expected)) throw new Error('mining_discovery_binding_changed')
  }))
}

/** Source identities stay build-pinned. A catalog may never replace these roots. */
export async function verifyMiningBase(rpc: MiningDiscoveryRpc, d: MiningProductDeployment,
  expectedSigner: MiningAddress, block?: string): Promise<MiningDiscoveryBlock> {
  if (d.chainId !== 1952 || !address(expectedSigner) || await rpc.request('eth_chainId') !== '0x7a0') throw new Error('mining_discovery_wrong_chain')
  const head = await snapshot(rpc, block), c = d.contracts
  await Promise.all(miningTargets(d).map((t) => matchIdentity(rpc, t.identity, head.number)))
  await bindings(rpc, [
    [c.manager.address, 'function signer() view returns(address)', [], expectedSigner],
    [c.manager.address, 'function POOL_FEE() view returns(uint24)', [], 0],
    [c.manager.address, 'function LAUNCH_FACTORY() view returns(address)', [], c.launchFactory.address],
    [c.manager.address, 'function REGISTRY() view returns(address)', [], c.registry.address],
    [c.manager.address, 'function V2_FACTORY() view returns(address)', [], c.v2Factory.address],
    [c.manager.address, 'function V2_ROUTER02() view returns(address)', [], c.router.address],
    [c.registry.address, 'function factoryOf(uint16) view returns(address)', [d.templateId], c.miningFactory.address],
    [c.miningFactory.address, 'function MANAGER() view returns(address)', [], c.manager.address],
    [c.miningFactory.address, 'function FAB() view returns(address)', [], c.fab.address],
    [c.miningFactory.address, 'function FARM() view returns(address)', [], c.farm.address],
    [c.miningFactory.address, 'function QUOTE_SIGNER() view returns(address)', [], expectedSigner],
    [c.miningFactory.address, 'function GRADUATION() view returns(uint256)', [], MINING_LAUNCH_TEST_POLICY.graduation],
    [c.farm.address, 'function QUOTE_SIGNER() view returns(address)', [], expectedSigner],
    [c.farm.address, 'function LAUNCH_FACTORY() view returns(address)', [], c.miningFactory.address],
    [c.farm.address, 'function FAB() view returns(address)', [], c.fab.address],
    [c.farm.address, 'function MINING() view returns(address)', [], c.mining.address],
    [c.farm.address, 'function MINER_NFT() view returns(address)', [], c.circuits.address],
    [c.farm.address, 'function NFT_FACTORY() view returns(address)', [], c.nftFactory.address],
    [c.farm.address, 'function MARKET() view returns(address)', [], c.circuitMarket.address],
    [c.farm.address, 'function ROUTER() view returns(address)', [], c.router.address],
    [c.farm.address, 'function WRAPPED_NATIVE() view returns(address)', [], c.wrappedNative.address],
    [c.router.address, 'function factory() view returns(address)', [], c.v2Factory.address],
    [c.router.address, 'function WETH() view returns(address)', [], c.wrappedNative.address],
    [c.mining.address, 'function rewardHistoryVersion() view returns(uint256)', [], 2n],
    [c.nftFactory.address, 'function circuitBeacon() view returns(address)', [], c.circuits.beacon!.address],
  ], head.number)
  await canonical(rpc, head)
  return head
}

/** Call after verifyMiningBase. Only the pinned Factory's registered products qualify.
 * Vault/tracker immutables differ per project; the trusted Factory proves their origin.
 */
export async function resolveMiningProject(rpc: MiningDiscoveryRpc, d: MiningProductDeployment,
  token: MiningAddress, expectedSigner: MiningAddress, verifiedBase: MiningDiscoveryBlock): Promise<MiningProject> {
  if (d.chainId !== 1952 || !address(token) || !address(expectedSigner) || await rpc.request('eth_chainId') !== '0x7a0') throw new Error('mining_discovery_wrong_chain')
  await canonical(rpc, verifiedBase)
  const head = verifiedBase, at = head.number, c = d.contracts
  const read = (to: MiningAddress, signature: string, args: readonly unknown[] = []): Promise<unknown> => miningDiscoveryRead(rpc, to, signature, args, at)
  const [vault, factoryVault] = await Promise.all([
    read(c.manager.address, 'function vaultOf(address) view returns(address)', [token]),
    read(c.miningFactory.address, 'function vaultOf(address) view returns(address)', [token]),
  ])
  if (!address(vault) || !eq(vault, factoryVault)) throw new Error('mining_discovery_unregistered')
  const [holder, symbol, pair, tokenPair] = await Promise.all([
    read(vault, 'function tracker() view returns(address)'),
    read(token, 'function symbol() view returns(string)'),
    read(c.manager.address, 'function pairOf(address) view returns(address)', [token]),
    read(token, 'function pair() view returns(address)'),
  ])
  if (!address(holder)) throw new Error('mining_discovery_unregistered')
  if (typeof symbol !== 'string' || !/^TEST-[A-Z0-9-]{1,20}$/.test(symbol) || !eq(pair, tokenPair)) throw new Error('mining_discovery_wrong_project')
  await bindings(rpc, [
    [token, 'function taxSink() view returns(address)', [], vault],
    [token, 'function tracker() view returns(address)', [], holder],
    [vault, 'function TOKEN() view returns(address)', [], token],
    [vault, 'function FAB() view returns(address)', [], c.fab.address],
    [vault, 'function QUOTE() view returns(address)', [], c.fab.address],
    [vault, 'function FARM() view returns(address)', [], c.farm.address],
    [vault, 'function ROUTER() view returns(address)', [], c.router.address],
    [vault, 'function QUOTE_SIGNER() view returns(address)', [], expectedSigner],
    [c.farm.address, 'function registeredVault(address) view returns(bool)', [vault], true],
    [c.farm.address, 'function rewardReceiver(address) view returns(address)', [vault], holder],
    [holder, 'function TOKEN() view returns(address)', [], token],
    [holder, 'function FARM() view returns(address)', [], c.farm.address],
    [holder, 'function VAULT() view returns(address)', [], vault],
  ], at)
  const [tokenIdentity, vaultIdentity, holderIdentity] = await Promise.all([
    identity(rpc, token, at), identity(rpc, vault, at), identity(rpc, holder, at),
  ])
  const result: MiningProject = { symbol, token: tokenIdentity, vault: vaultIdentity, holder: holderIdentity }
  if (address(pair)) {
    const [registered, factory, token0, token1] = await Promise.all([
      read(c.v2Factory.address, 'function getPair(address,address) view returns(address)', [token, c.fab.address]),
      read(pair, 'function factory() view returns(address)'), read(pair, 'function token0() view returns(address)'), read(pair, 'function token1() view returns(address)'),
    ])
    if (!eq(registered, pair) || !eq(factory, c.v2Factory.address) || !(
      eq(token0, token) && eq(token1, c.fab.address) || eq(token1, token) && eq(token0, c.fab.address))) throw new Error('mining_discovery_foreign_pair')
    result.pair = await identity(rpc, pair, at)
  } else if (typeof pair !== 'string' || !/^0x0{40}$/.test(pair)) throw new Error('mining_discovery_wrong_pair')
  await canonical(rpc, head)
  return result
}
