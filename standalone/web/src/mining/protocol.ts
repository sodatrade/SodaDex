import { decodeFunctionResult, encodeFunctionData, keccak256, type Hex } from 'viem'
import { IMPLEMENTATION_SLOT, miningAbi, miningTargets, sameMiningAddress, type MiningReadRole, type MiningWriteRole } from '../../../mining-calls'
import type { MiningAddress, MiningContractIdentity, MiningProductDeployment } from '../../../mining-products'
import { rpc } from '../lib/readRpc'

export type MiningRpc = typeof rpc
export function miningData(role: MiningWriteRole, name: string, args: readonly unknown[] = []): Hex {
  return encodeFunctionData({ abi: miningAbi(role, 'write'), functionName: name, args })
}
export async function productRead(read: MiningRpc, to: MiningAddress, role: MiningReadRole, name: string,
  args: readonly unknown[] = [], block = 'latest'): Promise<unknown> {
  const abi = miningAbi(role, 'read'), data = encodeFunctionData({ abi, functionName: name, args })
  const raw = await read('eth_call', [{ to, data }, block])
  if (typeof raw !== 'string' || !/^0x(?:[a-fA-F0-9]{2})*$/.test(raw)) throw new Error('miningReadFailed')
  return decodeFunctionResult({ abi, functionName: name, data: raw as Hex })
}
export function miningUint(v: unknown): bigint {
  if (typeof v !== 'bigint' || v < 0n) throw new Error('miningReadFailed')
  return v
}
export async function verifyMiningIdentity(read: MiningRpc, identity: MiningContractIdentity, block: string): Promise<void> {
  const code = await read('eth_getCode', [identity.address, block])
  if (typeof code !== 'string' || code === '0x' || !/^0x(?:[a-fA-F0-9]{2})+$/.test(code) ||
      keccak256(code as Hex).toLowerCase() !== identity.runtimeKeccak256.toLowerCase()) throw new Error('miningVersionChanged')
  if (identity.implementation) {
    const slot = await read('eth_getStorageAt', [identity.address, IMPLEMENTATION_SLOT, block])
    if (typeof slot !== 'string' || !/^0x0{24}[a-fA-F0-9]{40}$/.test(slot) ||
        !sameMiningAddress(`0x${slot.slice(-40)}`, identity.implementation.address)) throw new Error('miningVersionChanged')
    await verifyMiningIdentity(read, identity.implementation, block)
  }
  if (identity.beacon) {
    await verifyMiningIdentity(read, { address: identity.beacon.address, runtimeKeccak256: identity.beacon.runtimeKeccak256 }, block)
    await verifyMiningIdentity(read, identity.beacon.implementation, block)
    const implementation = await productRead(read, identity.beacon.address, 'beacon', 'implementation', [], block)
    if (typeof implementation !== 'string' || !sameMiningAddress(implementation, identity.beacon.implementation.address)) throw new Error('miningVersionChanged')
  }
}
/** A proxy's runtime alone does not prove which business implementation is active. */
export async function verifyMiningDeployment(read: MiningRpc, d: MiningProductDeployment): Promise<void> {
  if (await read('eth_chainId') !== '0x7a0') throw new Error('miningWrongNetwork')
  const block = await read('eth_blockNumber')
  if (typeof block !== 'string' || !/^0x[0-9a-fA-F]+$/.test(block)) throw new Error('miningReadFailed')
  await Promise.all(miningTargets(d).map((target) => verifyMiningIdentity(read, target.identity, block)))
  const c = d.contracts
  const bindings: [MiningAddress, MiningReadRole, string, readonly unknown[], string | bigint | number | boolean][] = [
    [c.mining.address, 'mining', 'rewardHistoryVersion', [], 2n],
    [c.fab.address, 'fab', 'decimals', [], 8],
    [c.fragmentVault.address, 'fragmentVault', 'MINING', [], c.mining.address],
    [c.fragmentVault.address, 'fragmentVault', 'MINER_NFT', [], c.circuits.address],
    [c.fragmentVault.address, 'fragmentVault', 'REWARD_ASSET', [], c.fab.address],
    [c.fragmentPool.address, 'fragmentPool', 'VAULT', [], c.fragmentVault.address],
    [c.minerBuyer.address, 'minerBuyer', 'VAULT', [], c.fragmentVault.address],
    [c.minerBuyer.address, 'minerBuyer', 'MARKET', [], c.circuitMarket.address],
    [c.minerBuyer.address, 'minerBuyer', 'MINER_NFT', [], c.circuits.address],
    [c.farm.address, 'farm', 'FAB', [], c.fab.address],
    [c.farm.address, 'farm', 'MINING_ASSET', [], c.fab.address],
    [c.farm.address, 'farm', 'MINING', [], c.mining.address],
    [c.farm.address, 'farm', 'REWARD_HISTORY', [], c.mining.address],
    [c.farm.address, 'farm', 'MINER_NFT', [], c.circuits.address],
    [c.farm.address, 'farm', 'NFT_FACTORY', [], c.nftFactory.address],
    [c.farm.address, 'farm', 'MARKET', [], c.circuitMarket.address],
    [c.farm.address, 'farm', 'ROUTER', [], c.router.address],
    [c.farm.address, 'farm', 'WRAPPED_NATIVE', [], c.wrappedNative.address],
    [c.farm.address, 'farm', 'LAUNCH_FACTORY', [], c.miningFactory.address],
    [c.miningFactory.address, 'miningFactory', 'FARM', [], c.farm.address],
    [c.miningFactory.address, 'miningFactory', 'FAB', [], c.fab.address],
    [c.circuits.address, 'circuits', 'factory', [], c.nftFactory.address],
    [c.circuitMarket.address, 'circuitMarket', 'factory', [], c.nftFactory.address],
    [c.nftFactory.address, 'nftFactory', 'isCPU', [c.circuits.address], true],
    [c.nftFactory.address, 'nftFactory', 'circuitBeacon', [], c.circuits.beacon!.address],
    [c.manager.address, 'manager', 'LAUNCH_FACTORY', [], c.launchFactory.address],
    [c.manager.address, 'manager', 'REGISTRY', [], c.registry.address],
    [c.manager.address, 'manager', 'V2_ROUTER02', [], c.router.address],
    [c.router.address, 'router', 'WETH', [], c.wrappedNative.address],
    [c.router.address, 'router', 'factory', [], c.v2Factory.address],
    [c.manager.address, 'manager', 'V2_LOCKER', [], c.v2Locker.address],
    [c.manager.address, 'manager', 'LIQUIDITY_HELPER', [], c.liquidityHelper.address],
    [c.registry.address, 'registry', 'factoryOf', [d.templateId], c.miningFactory.address],
  ]
  for (const p of d.projects) bindings.push(
    [c.manager.address, 'manager', 'vaultOf', [p.token.address], p.vault.address],
    [p.vault.address, 'projectVault', 'tracker', [], p.holder.address],
    [p.token.address, 'projectToken', 'taxSink', [], p.vault.address],
    [p.vault.address, 'projectVault', 'TOKEN', [], p.token.address],
    [p.vault.address, 'projectVault', 'FAB', [], c.fab.address],
    [p.vault.address, 'projectVault', 'FARM', [], c.farm.address],
    [c.farm.address, 'farm', 'registeredVault', [p.vault.address], true],
    [c.farm.address, 'farm', 'rewardReceiver', [p.vault.address], p.holder.address],
    [p.holder.address, 'holder', 'TOKEN', [], p.token.address],
    [p.holder.address, 'holder', 'FARM', [], c.farm.address],
    [p.holder.address, 'holder', 'VAULT', [], p.vault.address],
    ...(p.pair ? [[c.manager.address, 'manager', 'pairOf', [p.token.address], p.pair.address] as typeof bindings[number]] : []))
  await Promise.all(bindings.map(async ([to, role, name, args, expected]) => {
    const result = await productRead(read, to, role, name, args, block)
    if (typeof expected === 'string' ? typeof result !== 'string' || !sameMiningAddress(result, expected) : result !== expected)
      throw new Error('miningVersionChanged')
  }))
}
