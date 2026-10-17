import { decodeFunctionResult, encodeFunctionData, parseAbi, serializeTypedData, type Hex } from 'viem'
import { orderTypedData, parseLimitOrder, type SodaLimitOrder } from '../../../../order-types'
import { WOKB_ADDRESS } from '../../domain/assets'
import { hexQuantity } from '../../lib/rpc'
import { erc20Abi } from '../../trading/abis'
import { CONTRACTS } from '../../trading/config'
import { TradeError } from '../../trading/types'
import { createExecutionSession, type ExecutionContext } from '../../trading/walletExecution'
import type { OrderDeployment } from './config'
export const orderReadAbi = parseAbi(['function nonceStatus(address maker,uint256 nonce) view returns (uint8)', 'function cancel(uint256 nonce)'])
/** A witness signature authorizes exactly one order. The maker never approves the keeper. */
export async function signLimitOrder(order: SodaLimitOrder, deployment: OrderDeployment, context: ExecutionContext): Promise<Hex> {
  if (!deployment.executionEnabled) throw new TradeError('tradePaused')
  parseLimitOrder(order, { ...CONTRACTS, settlement: deployment.settlement, wrappedNative: WOKB_ADDRESS })
  if (order.settlement.toLowerCase() !== deployment.settlement.toLowerCase() || order.maker.toLowerCase() !== context.identity.address.toLowerCase()) throw new TradeError('tradeUnavailable')
  const session = createExecutionSession(context, { requiresPublicSwaps: false })
  await session.checkNetwork()
  const call = async (to: Hex, data: Hex): Promise<Hex> => {
    const result = await session.read('eth_call', [{ to, data }, 'latest']); session.assertCurrent()
    if (typeof result !== 'string' || !/^0x[\da-f]*$/i.test(result)) throw new TradeError('tradeFailed')
    return result as Hex
  }
  const status = await call(order.settlement, encodeFunctionData({ abi: orderReadAbi, functionName: 'nonceStatus', args: [order.maker, BigInt(order.nonce)] }))
  if (decodeFunctionResult({ abi: orderReadAbi, functionName: 'nonceStatus', data: status }) !== 0) throw new TradeError('tradeUnavailable')
  const block = await session.read('eth_getBlockByNumber', ['latest', false])
  if (!block || typeof block !== 'object' || !('timestamp' in block) || hexQuantity(block.timestamp) >= BigInt(order.expiry)) throw new TradeError('tradeExpired')
  const allowance = async (): Promise<bigint> => decodeFunctionResult({ abi: erc20Abi, functionName: 'allowance', data: await call(order.inputToken,
    encodeFunctionData({ abi: erc20Abi, functionName: 'allowance', args: [order.maker, CONTRACTS.permit2] })) })
  const sendApproval = async (amount: bigint): Promise<void> => { await session.send({ from: order.maker, to: order.inputToken, value: '0x0',
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [CONTRACTS.permit2, amount] }) }, amount === 0n ? 'tradeResetApproval' : 'tradeTokenApproval', 'approval') }
  const amount = BigInt(order.amountIn), allowed = await allowance()
  if (allowed < amount) {
    if (allowed > 0n) { await sendApproval(0n); if (await allowance() !== 0n) throw new TradeError('tradeFailed') }
    await sendApproval(amount)
    if (await allowance() < amount) throw new TradeError('tradeFailed')
  }
  session.assertCurrent()
  const accounts = await context.identity.provider.request({ method: 'eth_accounts' })
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== order.maker.toLowerCase()) throw new TradeError('tradeIdentityChanged')
  if (hexQuantity(await context.identity.provider.request({ method: 'eth_chainId' })) !== 196n) throw new TradeError('tradeIdentityChanged')
  session.assertCurrent()
  const typed = orderTypedData(order, CONTRACTS.permit2)
  const signature = await context.identity.provider.request({ method: 'eth_signTypedData_v4', params: [order.maker,
    serializeTypedData({ ...typed, domain: { ...typed.domain, chainId: 196n }, types: { ...typed.types, EIP712Domain: [
      { name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' },
    ] as const } })] })
  session.assertCurrent()
  if (typeof signature !== 'string' || !/^0x(?:[\da-f]{2})+$/i.test(signature)) throw new TradeError('tradeFailed')
  return signature as Hex
}
export async function cancelLimitOrder(order: SodaLimitOrder, deployment: OrderDeployment, context: ExecutionContext): Promise<Hex> {
  if (order.settlement.toLowerCase() !== deployment.settlement.toLowerCase() || order.maker.toLowerCase() !== context.identity.address.toLowerCase()) throw new TradeError('tradeUnavailable')
  const session = createExecutionSession(context, { requiresPublicSwaps: false }); await session.checkNetwork()
  return session.send({ from: order.maker, to: order.settlement, value: '0x0', data: encodeFunctionData({ abi: orderReadAbi, functionName: 'cancel', args: [BigInt(order.nonce)] }) }, 'tradeSending', 'swap')
}
