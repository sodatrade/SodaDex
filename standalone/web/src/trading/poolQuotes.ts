import { v2Quote } from './v2Trade'
import { decodeFunctionResult, encodeFunctionData, toHex, type Hex } from 'viem'
import type { AnyPool } from '../liquidity/v2Types'
import { poolKey } from '../liquidity/pools'
import { hexQuantity, rpc } from '../lib/rpc'
import { v3QuoterAbi, v4QuoterAbi } from './abis'
import { CONTRACTS } from './config'
import type { PublicRpc } from './types'

/** A direct, read-only quote for any discovered own pool; it creates no wallet intent. */
export async function getPoolQuote(pool: AnyPool, zeroForOne: boolean, amount: bigint, read: PublicRpc = rpc): Promise<bigint> {
  if (!pool.initialized || amount <= 0n || amount >= 2n ** 128n) throw new Error('Invalid quote amount')
  if (hexQuantity(await read('eth_chainId')) !== 196n) throw new Error('Wrong chain')
  const block = toHex(hexQuantity(await read('eth_blockNumber')))
  if (pool.protocol === 'v2') return v2Quote(pool, zeroForOne, amount, false, read, block)
  if (pool.protocol === 'v3') {
    const data = encodeFunctionData({ abi: v3QuoterAbi, functionName: 'quoteExactInputSingle', args: [{
      tokenIn: zeroForOne ? pool.currency0.address : pool.currency1.address,
      tokenOut: zeroForOne ? pool.currency1.address : pool.currency0.address,
      amountIn: amount, fee: pool.fee, sqrtPriceLimitX96: 0n,
    }] })
    const result = await read('eth_call', [{ to: CONTRACTS.v3Quoter, data }, block])
    return decodeFunctionResult({ abi: v3QuoterAbi, functionName: 'quoteExactInputSingle', data: result as Hex })[0]
  }
  const data = encodeFunctionData({ abi: v4QuoterAbi, functionName: 'quoteExactInputSingle', args: [{
    poolKey: poolKey(pool), zeroForOne, exactAmount: amount, hookData: '0x',
  }] })
  const result = await read('eth_call', [{ to: CONTRACTS.v4Quoter, data }, block])
  return decodeFunctionResult({ abi: v4QuoterAbi, functionName: 'quoteExactInputSingle', data: result as Hex })[0]
}
