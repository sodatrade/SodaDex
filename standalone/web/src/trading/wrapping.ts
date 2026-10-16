import { encodeFunctionData, isAddress, parseAbi, toHex, zeroAddress, type Address, type Hex } from 'viem'
import { WOKB_ADDRESS } from '../domain/assets'
import { TradeError, type Transaction } from './types'
import { createExecutionSession, type ExecutionContext } from './walletExecution'

export const wrappedNativeAbi = parseAbi(['function deposit() payable', 'function withdraw(uint256 amount)'])
export interface WrapRequest {
  direction: 'wrap' | 'unwrap'
  amount: bigint
}
/** Official wrapped OKB only; deposit/withdraw is 1:1 and uses no pool or token approval. */
export function buildWrap(request: WrapRequest, owner: Address): Transaction {
  if (!isAddress(owner) || owner === zeroAddress || request.amount <= 0n || request.amount >= 2n ** 128n ||
    (request.direction !== 'wrap' && request.direction !== 'unwrap')) throw new TradeError('tradeUnavailable')
  return { from: owner, to: WOKB_ADDRESS,
    data: request.direction === 'wrap'
      ? encodeFunctionData({ abi: wrappedNativeAbi, functionName: 'deposit' })
      : encodeFunctionData({ abi: wrappedNativeAbi, functionName: 'withdraw', args: [request.amount] }),
    value: toHex(request.direction === 'wrap' ? request.amount : 0n) }
}
export async function executeWrap(request: WrapRequest, c: ExecutionContext): Promise<Hex> {
  const { progress, send, checkNetwork } = createExecutionSession(c)
  const tx = buildWrap(request, c.identity.address)
  progress('tradePreparing')
  await checkNetwork()
  const hash = await send(tx, 'tradeSending', 'swap')
  c.onProgress({ stage: 'tradeSucceeded', hash, kind: 'swap' })
  return hash
}
