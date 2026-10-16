import { decodeFunctionResult, encodeFunctionData, isAddress, parseAbi, toHex, zeroAddress, type Address, type Hex } from 'viem'
import { validateCurrency } from '../liquidity/currencies'
import type { Currency } from '../liquidity/types'
import { hexQuantity } from '../lib/rpc'
import { TradeError, type Transaction } from './types'
import { createExecutionSession, type ExecutionContext } from './walletExecution'

export interface TransferRequest {
  currency: Currency
  recipient: Address
  amount: bigint
}
export const erc20TransferAbi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address recipient,uint256 amount) returns (bool)',
])
export function buildTransfer(request: TransferRequest, owner: Address): Transaction {
  try {
    validateCurrency(request.currency)
    if (!isAddress(owner) || owner === zeroAddress || !isAddress(request.recipient) || request.recipient === zeroAddress ||
      typeof request.amount !== 'bigint' || request.amount <= 0n || request.amount >= 2n ** 256n ||
      (!request.currency.native && request.currency.address === zeroAddress)) throw new Error('Invalid transfer')
  } catch {
    throw new TradeError('tradeUnavailable')
  }
  return request.currency.native
    ? { from: owner, to: request.recipient, data: '0x', value: toHex(request.amount) }
    : { from: owner, to: request.currency.address, value: '0x0', data: encodeFunctionData({
      abi: erc20TransferAbi, functionName: 'transfer', args: [request.recipient, request.amount],
    }) }
}

/** Same-chain wallet transfer. It never uses a Router, token approval or server signer. */
export async function executeTransfer(request: TransferRequest, c: ExecutionContext): Promise<Hex> {
  const tx = buildTransfer(request, c.identity.address)
  const { read, assertCurrent, progress, send, checkNetwork } = createExecutionSession(c, { requiresPublicSwaps: false })
  progress('tradePreparing')
  await checkNetwork()
  let balance: bigint
  if (request.currency.native) balance = hexQuantity(await read('eth_getBalance', [c.identity.address, 'latest']))
  else {
    const data = encodeFunctionData({ abi: erc20TransferAbi, functionName: 'balanceOf', args: [c.identity.address] })
    const result = await read('eth_call', [{ to: request.currency.address, data }, 'latest'])
    balance = decodeFunctionResult({ abi: erc20TransferAbi, functionName: 'balanceOf', data: result as Hex })
  }
  assertCurrent()
  if (balance < request.amount) throw new TradeError(request.currency.native ? 'tradeGasBalance' : 'tradeUnavailable')
  const hash = await send(tx, 'tradeSending', 'swap', { validateBooleanReturn: !request.currency.native })
  c.onProgress({ stage: 'tradeSucceeded', hash, kind: 'swap' })
  return hash
}
