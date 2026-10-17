import { decodeFunctionResult, encodeFunctionData, parseAbi, type Abi, type Hex } from 'viem'
import { MINING_BASE, MINING_READ_SIGNATURES, type MiningBaseRole } from '../../../mining-contracts'
import { rpc } from '../lib/readRpc'
import { NETWORK } from '../network'

export async function miningRead(role: MiningBaseRole, functionName: string, args: readonly unknown[], block: bigint): Promise<unknown> {
  if (NETWORK.chainId !== MINING_BASE.chainId) throw new Error('Mining contracts require chain 1952')
  const abi: Abi = parseAbi(MINING_READ_SIGNATURES[role])
  const data = encodeFunctionData({ abi, functionName, args })
  const raw = await rpc('eth_call', [{ to: MINING_BASE[role], data }, `0x${block.toString(16)}`])
  if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]*$/.test(raw)) throw new Error('Invalid mining contract response')
  return decodeFunctionResult({ abi, functionName, data: raw as Hex })
}

function uint(value: unknown): bigint {
  if (typeof value !== 'bigint' || value < 0n) throw new Error('Invalid mining amount')
  return value
}

export async function miningOverview(block: bigint): Promise<{ totalMined: bigint; minerCount: bigint; verifiedCount: bigint }> {
  const [totalMined, minerCount, verifiedCount] = await Promise.all([
    miningRead('mining', 'totalMined', [], block), miningRead('mining', 'minerCount', [], block),
    miningRead('mining', 'verifMinerCount', [], block),
  ])
  return { totalMined: uint(totalMined), minerCount: uint(minerCount), verifiedCount: uint(verifiedCount) }
}

export async function miningAccount(block: bigint, account: `0x${string}`): Promise<{ fab: bigint; miners: bigint }> {
  const [fab, miners] = await Promise.all([miningRead('fab', 'balanceOf', [account], block), miningRead('circuits', 'balanceOf', [account], block)])
  return { fab: uint(fab), miners: uint(miners) }
}
