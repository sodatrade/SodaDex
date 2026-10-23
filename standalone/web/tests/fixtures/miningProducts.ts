import { encodeFunctionResult, decodeFunctionData, keccak256, type Hex } from 'viem'
import { IMPLEMENTATION_SLOT, miningAbi, miningTargets } from '../../../mining-calls'
import { MINING_PRODUCT_ROLES, parseMiningDeployment, type MiningAddress, type MiningProductDeployment } from '../../../mining-products'
import type { MiningRpc } from '../../src/mining/protocol'

export const miningTestAddress = (n: number): MiningAddress => `0x${n.toString(16).padStart(40, '0')}`
export const MINING_TEST_ACCOUNT = miningTestAddress(900)
export const MINING_TEST_HASH = `0x${'a'.repeat(64)}` as Hex
const code = '0x60006000' as const, hash = keccak256(code)
export function miningTestDeployment(): MiningProductDeployment {
  const contracts = Object.fromEntries(MINING_PRODUCT_ROLES.map((role, i) => [role, { address: miningTestAddress(i + 1), runtimeKeccak256: hash,
    ...(['mining', 'manager', 'nftFactory', 'circuitMarket'].includes(role) ? { implementation: { address: miningTestAddress(i + 101), runtimeKeccak256: hash } } : {}),
    ...(role === 'circuits' ? { beacon: { address: miningTestAddress(200), runtimeKeccak256: hash, implementation: { address: miningTestAddress(201), runtimeKeccak256: hash } } } : {}),
  }]))
  return parseMiningDeployment({ schemaVersion: 1, chainId: 1952, state: 'ready', version: 'fixture-v2', sourceHistoryVersion: 2,
    genesisBlock: '1', templateId: 1, contracts, projects: [{ symbol: 'TEST-A', token: { address: miningTestAddress(301), runtimeKeccak256: hash },
      vault: { address: miningTestAddress(302), runtimeKeccak256: hash }, holder: { address: miningTestAddress(303), runtimeKeccak256: hash },
      pair: { address: miningTestAddress(304), runtimeKeccak256: hash } }] }) as MiningProductDeployment
}
export function miningTestRpc(d: MiningProductDeployment, override?: (name: string, to: string, args: readonly unknown[]) => unknown): MiningRpc {
  const c = d.contracts, p = d.projects[0]
  const binding: Record<string, unknown> = { rewardHistoryVersion: 2n, decimals: 8, MINING: c.mining.address,
    MINER_NFT: c.circuits.address, REWARD_ASSET: c.fab.address, VAULT: c.fragmentVault.address,
    FAB: c.fab.address, MINING_ASSET: c.fab.address, REWARD_HISTORY: c.mining.address, NFT_FACTORY: c.nftFactory.address,
    MARKET: c.circuitMarket.address, ROUTER: c.router.address, WRAPPED_NATIVE: c.wrappedNative.address,
    FARM: c.farm.address, REGISTRY: c.registry.address, V2_ROUTER02: c.router.address, V2_LOCKER: c.v2Locker.address,
    LIQUIDITY_HELPER: c.liquidityHelper.address, factoryOf: c.miningFactory.address, isCPU: true,
    circuitBeacon: c.circuits.beacon!.address, implementation: c.circuits.beacon!.implementation.address,
    factory: c.nftFactory.address, TOKEN: p.token.address, tracker: p.holder.address, vaultOf: p.vault.address,
    pairOf: p.pair!.address, registeredVault: true, rewardReceiver: p.holder.address, paused: false,
    claimable: 100_000_000n, totalSupply: 1_000_000_000_000_000_000_000n, balanceOf: 10n ** 25n, allowance: 0n,
    WETH: c.wrappedNative.address, protectionActive: false, protectionEndsAt: 0n, unlocked: true, taxSink: p.vault.address,
  }
  return async (method, params = []) => {
    if (method === 'eth_chainId') return '0x7a0'
    if (method === 'eth_blockNumber') return '0x10'
    if (method === 'eth_getCode') return code
    if (method === 'eth_getBalance') return '0x100000000000000000'
    if (method === 'eth_gasPrice') return '0x1'
    if (method === 'eth_estimateGas') return '0x10000'
    if (method === 'eth_getStorageAt') {
      if (params[1] !== IMPLEMENTATION_SLOT) throw new Error('Unexpected slot')
      const identity = miningTargets(d).find((t) => t.identity.address === params[0])!.identity
      return `0x${identity.implementation!.address.slice(2).padStart(64, '0')}`
    }
    if (method === 'eth_call') {
      const tx = params[0] as { to: MiningAddress; from?: string; data: Hex }
      if (tx.from) return '0x'
      const target = miningTargets(d).find((t) => t.identity.address === tx.to)
      if (!target?.read) throw new Error(`Unexpected target ${tx.to}`)
      const abi = miningAbi(target.read, 'read'), decoded = decodeFunctionData({ abi, data: tx.data })
      const name = decoded.functionName!, args = decoded.args ?? []
      let value = override?.(name, tx.to, args)
      if (value === undefined) value = name === 'LAUNCH_FACTORY' ? tx.to === c.farm.address ? c.miningFactory.address : c.launchFactory.address
        : name === 'VAULT' && tx.to === p.holder.address ? p.vault.address : name === 'factory' && tx.to === c.router.address ? c.v2Factory.address : binding[name]
      if (value === undefined) throw new Error(`Unexpected function ${name}`)
      return encodeFunctionResult({ abi, functionName: name, result: value })
    }
    throw new Error(`Unexpected method ${method}`)
  }
}
