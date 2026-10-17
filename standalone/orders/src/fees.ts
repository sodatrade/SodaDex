import { bytesToHex, hexToBytes, parseAbi, type PublicClient } from 'viem'
import { ChainFailure } from './chain-types.ts'

// The same reviewed X Layer fee model used by scripts/sodadex/pool_chain.py.
export const FEE_ORACLE = '0x420000000000000000000000000000000000000F' as const
export const FEE_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const
export const FEE_IMPLEMENTATION = '0x4f1db3c6abd250ba86e0928471a8f7db3afd88f1' as const
export const FEE_IMPLEMENTATION_SHA256 = '7e49db5c1d54bab9a75a387dc972d4fb1c3c78f3fbf31336a9d8413d6d125cc3'
const FEE_ABI = parseAbi(['function getL1FeeUpperBound(uint256) view returns(uint256)', 'function getOperatorFee(uint256) view returns(uint256)'])

/** Gas-only commitments are valid only while this pinned model proves every extra fee is zero. */
export async function assertZeroAdditionalFees(client: PublicClient, serializedBytes: number, gas: bigint, blockNumber?: bigint): Promise<void> {
  try {
    if (!Number.isSafeInteger(serializedBytes) || serializedBytes <= 0 || gas <= 0n) throw new ChainFailure('unavailable')
    const at = blockNumber ?? await client.getBlockNumber({ cacheTime: 0 })
    const [implementation, code, l1, operator] = await Promise.all([
      client.getStorageAt({ address: FEE_ORACLE, slot: FEE_IMPLEMENTATION_SLOT, blockNumber: at }),
      client.getBytecode({ address: FEE_IMPLEMENTATION, blockNumber: at }),
      client.readContract({ address: FEE_ORACLE, abi: FEE_ABI, functionName: 'getL1FeeUpperBound', args: [BigInt(serializedBytes)], blockNumber: at }),
      client.readContract({ address: FEE_ORACLE, abi: FEE_ABI, functionName: 'getOperatorFee', args: [gas], blockNumber: at }),
    ])
    if (implementation?.toLowerCase() !== `0x${'0'.repeat(24)}${FEE_IMPLEMENTATION.slice(2)}` || !code || code === '0x' || l1 !== 0n || operator !== 0n) throw new ChainFailure('unavailable')
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(hexToBytes(code)))
    if (bytesToHex(new Uint8Array(digest)).slice(2) !== FEE_IMPLEMENTATION_SHA256) throw new ChainFailure('unavailable')
  } catch { throw new ChainFailure('unavailable') }
}

/** viem preserves RPC extension fields; absent ones need the separate historical oracle proof. */
export function assertZeroReceiptExtras(receipt: object): void {
  const fields = receipt as Record<string, unknown>
  for (const name of ['l1Fee', 'operatorFee', 'operatorFeeScalar', 'operatorFeeConstant']) {
    const value = fields[name]
    if (value === undefined) continue
    if (typeof value !== 'bigint' && (typeof value !== 'string' || !/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(value))) throw new ChainFailure('unavailable')
    if (BigInt(value) !== 0n) throw new ChainFailure('unavailable')
  }
}
