import { encodeFunctionData, isAddress, toHex, zeroAddress, type Address } from 'viem'
import { V2, V2_PAIR, V2_ROUTER } from '../../../v2-protocol'
import { rpc } from '../lib/rpc'
import { latestTimestamp } from '../trading/quotes'
import type { Transaction } from '../trading/types'
import { LP_DEADLINE_SECONDS } from './config'
import { call } from './rpc'
import { LiquidityError, type PublicRpc } from './types'
import { integerSqrt, v2Deposit, v2Minimum, v2Supply } from './v2Math'
import { discoverV2 } from './v2Pools'
import type { V2Pool } from './v2Types'

export type V2Operation =
  | { kind: 'add'; pool: V2Pool; amount0: bigint; amount1: bigint; slippageBps: number }
  | { kind: 'remove'; pool: V2Pool; liquidity: bigint; slippageBps: number }
export interface V2Preview {
  operation: V2Operation
  pool: V2Pool
  owner: Address
  deadline: bigint
  amount0: bigint
  amount1: bigint
  minimum0: bigint
  minimum1: bigint
  liquidity: bigint
  transaction: Transaction
}
export function encodeV2Liquidity(p: Omit<V2Preview, 'transaction'>): Transaction {
  const { pool, operation: op, owner, deadline, minimum0, minimum1 } = p
  if (!isAddress(owner) || owner === zeroAddress || deadline <= 0n || deadline >= 2n ** 256n ||
    minimum0 !== v2Minimum(p.amount0, op.slippageBps) || minimum1 !== v2Minimum(p.amount1, op.slippageBps))
    throw new LiquidityError('invalidAmount')
  const a = pool.currency0, b = pool.currency1, native = a.native || b.native
  const token = a.native ? b : a, tokenMin = a.native ? minimum1 : minimum0, nativeMin = a.native ? minimum0 : minimum1
  if (op.kind === 'add') {
    if (op.amount0 < p.amount0 || op.amount1 < p.amount1 || op.amount0 >= 2n ** 112n || op.amount1 >= 2n ** 112n)
      throw new LiquidityError('invalidAmount')
    const data = native ? encodeFunctionData({ abi: V2_ROUTER, functionName: 'addLiquidityETH',
      args: [token.address, a.native ? op.amount1 : op.amount0, tokenMin, nativeMin, owner, deadline] }) :
      encodeFunctionData({ abi: V2_ROUTER, functionName: 'addLiquidity', args: [a.address, b.address, op.amount0, op.amount1, minimum0, minimum1, owner, deadline] })
    return { from: owner, to: V2.router, data, value: toHex(a.native ? op.amount0 : b.native ? op.amount1 : 0n) }
  }
  if (op.liquidity <= 0n || op.liquidity !== p.liquidity || !pool.address) throw new LiquidityError('invalidAmount')
  const data = native ? encodeFunctionData({ abi: V2_ROUTER, functionName: 'removeLiquidityETH',
    args: [token.address, op.liquidity, tokenMin, nativeMin, owner, deadline] }) :
    encodeFunctionData({ abi: V2_ROUTER, functionName: 'removeLiquidity', args: [a.address, b.address, op.liquidity, minimum0, minimum1, owner, deadline] })
  return { from: owner, to: V2.router, data, value: '0x0' }
}
export async function prepareV2(op: V2Operation, owner: Address, read: PublicRpc = rpc): Promise<V2Preview> {
  const pool = await discoverV2(op.pool.currency0, op.pool.currency1, read)
  if (pool.id.toLowerCase() !== op.pool.id.toLowerCase() || pool.initialized !== op.pool.initialized) throw new LiquidityError('poolChanged')
  const supply = v2Supply(pool.totalSupply, pool.reserve0, pool.reserve1, pool.kLast, pool.feeOn)
  let amount0: bigint, amount1: bigint, liquidity: bigint
  if (op.kind === 'add') {
    ;[amount0, amount1] = v2Deposit(op.amount0, op.amount1, pool.reserve0, pool.reserve1)
    if (!supply) liquidity = integerSqrt(amount0 * amount1) - 1000n
    else {
      const l0 = amount0 * supply / pool.reserve0, l1 = amount1 * supply / pool.reserve1
      liquidity = l0 < l1 ? l0 : l1
    }
  } else {
    if (!pool.address || !supply || op.liquidity <= 0n) throw new LiquidityError('invalidAmount')
    const balance = await call(V2_PAIR, pool.address, 'balanceOf', [owner], read) as bigint
    if (op.liquidity > balance) throw new LiquidityError('invalidAmount')
    liquidity = op.liquidity
    amount0 = liquidity * pool.reserve0 / supply
    amount1 = liquidity * pool.reserve1 / supply
  }
  if (liquidity <= 0n) throw new LiquidityError('invalidAmount')
  const preview = { operation: op, pool, owner, deadline: await latestTimestamp(read) + LP_DEADLINE_SECONDS,
    liquidity, amount0, amount1, minimum0: v2Minimum(amount0, op.slippageBps), minimum1: v2Minimum(amount1, op.slippageBps) }
  return { ...preview, transaction: encodeV2Liquidity(preview) }
}
