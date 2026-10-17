import { decodeFunctionData, encodeFunctionData, parseAbi, type Hex } from 'viem'
import { MINING_BASE, MINING_READ_SIGNATURES, type MiningBaseRole } from '../../mining-contracts'

const roles = Object.keys(MINING_READ_SIGNATURES) as MiningBaseRole[]
const reads = roles.map((role) => ({ address: MINING_BASE[role].toLowerCase(), abi: parseAbi(MINING_READ_SIGNATURES[role]) }))

/** Independent 1952 read-only ABI list; no 196 token or pool validator is consulted. */
export function validMiningRead(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const tx = value as Record<string, unknown>
  if (Object.keys(tx).some((key) => key !== 'to' && key !== 'data') || typeof tx.to !== 'string' || typeof tx.data !== 'string' ||
      !/^0x[0-9a-fA-F]+$/.test(tx.data) || tx.data.length > 138) return false
  const contract = reads.find((entry) => entry.address === String(tx.to).toLowerCase())
  if (!contract) return false
  try {
    const decoded = decodeFunctionData({ abi: contract.abi, data: tx.data as Hex })
    return encodeFunctionData({ abi: contract.abi, functionName: decoded.functionName, args: decoded.args }).toLowerCase() === tx.data.toLowerCase()
  } catch { return false }
}
