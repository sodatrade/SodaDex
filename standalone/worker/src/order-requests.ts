import { decodeFunctionData, encodeFunctionData, parseAbi, type Hex } from 'viem'
import { ORDER_DEPLOYMENT } from './order-config'
import type { OrderDeployment } from '../../order-deployment'
import { same } from './contracts'
const ORDER_READS = parseAbi(['function nonceStatus(address maker,uint256 nonce) view returns(uint8)'])
const ORDER_CANCEL = parseAbi(['function cancel(uint256 nonce)'])
/** Wallets may inspect and cancel only the configured SodaDEX test settlement. */
export function validOrderRequest(to: string, data: Hex, from: string | undefined, value: bigint, simulation: boolean, configured: OrderDeployment | undefined = ORDER_DEPLOYMENT): boolean {
  if (!configured || !same(to, configured.settlement) || value !== 0n) return false
  try {
    // Decode independently so read-only nonce queries cannot be admitted as estimateGas transactions.
    if (!simulation) {
      try {
        const decoded = decodeFunctionData({ abi: ORDER_READS, data })
        if (same(encodeFunctionData({ abi: ORDER_READS, functionName: decoded.functionName, args: decoded.args }), data)) return true
      } catch { /* A cancellation simulation requires the maker address below. */ }
    }
    const decoded = decodeFunctionData({ abi: ORDER_CANCEL, data })
    return !!from && same(encodeFunctionData({ abi: ORDER_CANCEL, functionName: decoded.functionName, args: decoded.args }), data)
  } catch { return false }
}
