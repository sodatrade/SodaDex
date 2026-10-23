import type { Hex } from 'viem'
import { read } from './rpc.ts'
import { ServiceError, type Rpc } from './types.ts'
const ORACLE = '0x420000000000000000000000000000000000000f'
const L1_BLOCK = '0x4200000000000000000000000000000000000015'
/** This deployment was approved only with zero L1/operator surcharges. Changes stop execution. */
export async function assertZeroAdditionalFees(rpc: Rpc, bytes: number, gas: bigint, block = 'latest'): Promise<void> {
  const [fjord, isthmus, scalar, constant, l1, operator] = await Promise.all([
    read<boolean>(rpc, ORACLE, 'function isFjord() view returns(bool)', [], block),
    read<boolean>(rpc, ORACLE, 'function isIsthmus() view returns(bool)', [], block),
    read<number>(rpc, L1_BLOCK, 'function operatorFeeScalar() view returns(uint32)', [], block),
    read<bigint>(rpc, L1_BLOCK, 'function operatorFeeConstant() view returns(uint64)', [], block),
    read<bigint>(rpc, ORACLE, 'function getL1FeeUpperBound(uint256) view returns(uint256)', [BigInt(bytes)], block),
    read<bigint>(rpc, ORACLE, 'function getOperatorFee(uint256) view returns(uint256)', [gas], block),
  ])
  if (!fjord || !isthmus || scalar !== 0 || constant !== 0n || l1 !== 0n || operator !== 0n) throw new ServiceError('additional_fee_model_changed', 503)
}
export const serializedBytes = (raw: Hex): number => (raw.length - 2) / 2
