import { encodeFunctionData, toHex, type Address } from 'viem'
import { V2, V2_ROUTER, V2_ROUTER_READ, v2StandardAssets } from '../../../v2-protocol'
import { call } from '../liquidity/rpc'
import type { V2Pool } from '../liquidity/v2Types'
import type { PoolTradeQuote } from './poolTradeTypes'
import type { PoolExactOutputQuote } from './poolExactOutputTypes'
import { TradeError, type PublicRpc, type Transaction } from './types'

export async function v2Quote(pool: V2Pool, zeroForOne: boolean, amount: bigint, exactOutput: boolean, read: PublicRpc, block = 'latest'): Promise<bigint> {
  if (!v2StandardAssets(pool.currency0.address, pool.currency1.address)) throw new TradeError('tradeUnsupported')
  const path = zeroForOne ? [pool.currency0.address, pool.currency1.address] : [pool.currency1.address, pool.currency0.address]
  const amounts = await call(V2_ROUTER_READ, V2.router, exactOutput ? 'getAmountsIn' : 'getAmountsOut', [amount, path], read, block) as readonly bigint[]
  if (amounts.length !== 2 || amounts.some(n => n <= 0n) || amounts[exactOutput ? 1 : 0] !== amount) throw new TradeError('tradeUnavailable')
  return amounts[exactOutput ? 0 : 1]
}
/** Called after the common quote/owner/slippage validation. No arbitrary path or recipient. */
export function encodeV2Trade(q: PoolTradeQuote | PoolExactOutputQuote, owner: Address, deadline: bigint): Transaction {
  if (q.pool.protocol !== 'v2' || !v2StandardAssets(q.pool.currency0.address, q.pool.currency1.address)) throw new TradeError('tradeUnsupported')
  const [input, output] = q.zeroForOne ? [q.pool.currency0, q.pool.currency1] : [q.pool.currency1, q.pool.currency0]
  const path = [input.address, output.address]
  if ('tradeType' in q) {
    const data = input.native ? encodeFunctionData({ abi: V2_ROUTER, functionName: 'swapETHForExactTokens', args: [q.amountOut, path, owner, deadline] }) :
      output.native ? encodeFunctionData({ abi: V2_ROUTER, functionName: 'swapTokensForExactETH', args: [q.amountOut, q.maximumIn, path, owner, deadline] }) :
      encodeFunctionData({ abi: V2_ROUTER, functionName: 'swapTokensForExactTokens', args: [q.amountOut, q.maximumIn, path, owner, deadline] })
    return { from: owner, to: V2.router, value: toHex(input.native ? q.maximumIn : 0n), data }
  }
  const data = input.native ? encodeFunctionData({ abi: V2_ROUTER, functionName: 'swapExactETHForTokens', args: [q.minimumOut, path, owner, deadline] }) :
    output.native ? encodeFunctionData({ abi: V2_ROUTER, functionName: 'swapExactTokensForETH', args: [q.amount, q.minimumOut, path, owner, deadline] }) :
    encodeFunctionData({ abi: V2_ROUTER, functionName: 'swapExactTokensForTokens', args: [q.amount, q.minimumOut, path, owner, deadline] })
  return { from: owner, to: V2.router, value: toHex(input.native ? q.amount : 0n), data }
}
