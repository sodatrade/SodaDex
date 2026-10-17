import { keccak256, toBytes } from 'viem'
import { IMPLEMENTATION_SLOT, miningTargets, sameMiningAddress, validMiningProductCall } from '../../mining-calls'
import { MINING_PRODUCTS, type MiningDeploymentState } from '../../mining-products'
import { validMiningRead } from './mining-reads'

const block = (v: unknown): v is string => typeof v === 'string' && /^(latest|safe|finalized|pending|0x[0-9a-fA-F]+)$/.test(v)
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const events = new Set([
  'Transfer(address,address,uint256)', 'Deposited(address,uint256,uint256,uint256)', 'Redeemed(address,uint256,uint256)',
  'Swapped(address,bool,uint256,uint256,uint256,uint256)', 'LiquidityAdded(address,uint256,uint256,uint256)',
  'LiquidityRemoved(address,uint256,uint256,uint256)', 'RewardsPaid(address,uint256)',
  'TokenCreated(address,address,address,uint256,string,address,address,uint16)',
  'GraduatedV2(address,address,address,uint128,uint128)',
].map((signature) => keccak256(toBytes(signature))))

/** 1952 owns its own call, proxy and event boundary. No 196 routing is enabled. */
export function validMiningRpcParams(method: string, params: unknown[], d: MiningDeploymentState = MINING_PRODUCTS): boolean {
  if (method === 'eth_call' || method === 'eth_estimateGas') {
    const simulation = record(params[0]) && typeof params[0].from === 'string'
    if (method === 'eth_call' && (params.length !== 2 || !block(params[1]))) return false
    if (method === 'eth_estimateGas' && ((params.length !== 1 && !(params.length === 2 && params[1] === 'pending')) || !simulation)) return false
    return (method === 'eth_call' && validMiningRead(params[0])) || (d.state === 'ready' && validMiningProductCall(params[0], d, simulation))
  }
  if (d.state !== 'ready') return false
  if (method === 'eth_getStorageAt') return params.length === 3 && typeof params[0] === 'string' &&
    ['mining', 'manager', 'nftFactory', 'circuitMarket'].some((role) =>
      sameMiningAddress(d.contracts[role as 'mining' | 'manager' | 'nftFactory' | 'circuitMarket'].address, String(params[0]))) &&
    params[1] === IMPLEMENTATION_SLOT && block(params[2])
  if (method === 'eth_getLogs') {
    if (params.length !== 1 || !record(params[0])) return false
    const f = params[0]
    if (Object.keys(f).some((k) => !['address', 'fromBlock', 'toBlock', 'topics'].includes(k)) || typeof f.address !== 'string' ||
        !miningTargets(d).some((t) => sameMiningAddress(t.identity.address, String(f.address))) ||
        typeof f.fromBlock !== 'string' || !/^0x[0-9a-fA-F]+$/.test(f.fromBlock) ||
        typeof f.toBlock !== 'string' || !/^0x[0-9a-fA-F]+$/.test(f.toBlock) || !Array.isArray(f.topics) ||
        f.topics.length < 1 || f.topics.length > 4 || !events.has(f.topics[0]) ||
        f.topics.some((t) => t !== null && (typeof t !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(t)))) return false
    const from = BigInt(f.fromBlock), to = BigInt(f.toBlock)
    return from >= BigInt(d.genesisBlock) && to >= from && to - from < 2000n
  }
  return false
}
