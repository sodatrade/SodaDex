import { describe, expect, it } from 'vitest'
import { encodeFunctionData, keccak256, parseAbi, toBytes } from 'viem'
import { IMPLEMENTATION_SLOT } from '../../mining-calls'
import { MINING_PRODUCT_ROLES, parseMiningDeployment, type MiningAddress, type MiningProductDeployment } from '../../mining-products'
import { validMiningRpcParams } from '../src/mining-product-rpc'

const address = (n: number): MiningAddress => `0x${n.toString(16).padStart(40, '0')}`
function fixture(): MiningProductDeployment {
  const identity = (n: number): { address: MiningAddress; runtimeKeccak256: `0x${string}` } => ({ address: address(n), runtimeKeccak256: `0x${'1'.repeat(64)}` })
  const contracts = Object.fromEntries(MINING_PRODUCT_ROLES.map((role, i) => [role, { ...identity(i + 1),
    ...(['mining', 'manager', 'nftFactory', 'circuitMarket'].includes(role) ? { implementation: identity(100 + i) } : {}),
    ...(role === 'circuits' ? { beacon: { ...identity(200), implementation: identity(201) } } : {}) }]))
  return parseMiningDeployment({ schemaVersion: 1, chainId: 1952, state: 'ready', version: 'worker-test', sourceHistoryVersion: 2,
    genesisBlock: '100', templateId: 0, contracts, projects: [] }) as MiningProductDeployment
}
const abi = parseAbi(['function swapExactIn(bool,uint256,uint256,uint256) returns(uint256)', 'function approve(address,uint256) returns(bool)'])
describe('1952 independent product RPC policy', () => {
  it('keeps all undeployed product writes disabled', () => {
    const d = fixture(), tx = { from: address(900), to: d.contracts.fragmentPool.address, value: '0x0',
      data: encodeFunctionData({ abi, functionName: 'swapExactIn', args: [false, 100n, 90n, BigInt(Math.floor(Date.now() / 1000) + 600)] }) }
    expect(validMiningRpcParams('eth_call', [tx, 'latest'], { state: 'pending', chainId: 1952 })).toBe(false)
    expect(validMiningRpcParams('eth_estimateGas', [tx], d)).toBe(true)
    expect(validMiningRpcParams('eth_estimateGas', [tx, 'pending'], d)).toBe(true)
    expect(validMiningRpcParams('eth_estimateGas', [tx, 'pending', {}], d)).toBe(false)
    expect(validMiningRpcParams('eth_call', [tx, 'latest'], d)).toBe(true)
    expect(validMiningRpcParams('eth_call', [tx, 'latest', {}], d)).toBe(false)
    expect(validMiningRpcParams('eth_call', [{ ...tx, value: '0x1' }, 'latest'], d)).toBe(false)
    expect(validMiningRpcParams('eth_call', [{ ...tx, to: address(999) }, 'latest'], d)).toBe(false)
  })
  it('does not allow arbitrary spenders or arbitrary proxy slots', () => {
    const d = fixture(), tx = { from: address(900), to: d.contracts.fab.address,
      data: encodeFunctionData({ abi, functionName: 'approve', args: [address(999), 100n] }) }
    expect(validMiningRpcParams('eth_estimateGas', [tx], d)).toBe(false)
    expect(validMiningRpcParams('eth_getStorageAt', [d.contracts.manager.address, IMPLEMENTATION_SLOT, 'latest'], d)).toBe(true)
    expect(validMiningRpcParams('eth_getStorageAt', [d.contracts.manager.address, '0x0', 'latest'], d)).toBe(false)
    expect(validMiningRpcParams('eth_getStorageAt', [d.contracts.circuits.address, IMPLEMENTATION_SLOT, 'latest'], d)).toBe(false)
  })
  it('bounds event scans by address, topic, genesis and 2000 blocks', () => {
    const d = fixture(), f = { address: d.contracts.circuits.address, fromBlock: '0x64', toBlock: '0x100', topics: [keccak256(toBytes('Transfer(address,address,uint256)'))] }
    expect(validMiningRpcParams('eth_getLogs', [f], d)).toBe(true)
    expect(validMiningRpcParams('eth_getLogs', [{ ...f, fromBlock: '0x0' }], d)).toBe(false)
    expect(validMiningRpcParams('eth_getLogs', [{ ...f, toBlock: '0x1000' }], d)).toBe(false)
    expect(validMiningRpcParams('eth_getLogs', [{ ...f, address: address(999) }], d)).toBe(false)
    expect(validMiningRpcParams('eth_getLogs', [{ ...f, topics: [] }], d)).toBe(false)
  })
})
