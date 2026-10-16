import { isAddress, type Address } from 'viem'
import { hexQuantity, rpc } from '../lib/rpc'
import { defaultLpSlippageBps, LP_CHAIN_ID, LP_CONTRACTS, LP_DEADLINE_SECONDS } from './config'
import { buildLiquidityTransaction, liquidityManager } from './encoding'
import { initializePrice, positionForLiquidity, positionFromAmounts, slippagePercent } from './math'
import { getPosition } from './positions'
import { refreshPool } from './pools'
import { LiquidityError, type LiquidityOperation, type LiquidityPreview, type PublicRpc } from './types'
export async function prepareLiquidity(
  operation: LiquidityOperation,
  owner: Address,
  read: PublicRpc = rpc,
): Promise<LiquidityPreview> {
  if (!isAddress(owner) || hexQuantity(await read('eth_chainId')) !== BigInt(LP_CHAIN_ID))
    throw new LiquidityError('identityChanged')
  const original = operation.kind === 'mint' ? operation.pool : operation.position.pool
  let pool = await refreshPool(original, read)
  if (operation.kind !== 'mint') {
    const current = await getPosition(operation.position.protocol, operation.position.tokenId, read)
    if (current.owner.toLowerCase() !== owner.toLowerCase()) throw new LiquidityError('notOwner')
    operation = { ...operation, position: current }
    // Percentage intent is resolved against the fresh position before the user reviews exact amounts.
    // Absolute-liquidity callers retain their original bound; execution never silently enlarges a reviewed burn.
    if (operation.kind === 'decrease' && operation.liquidityBps !== undefined) {
      if (!Number.isInteger(operation.liquidityBps) || operation.liquidityBps <= 0 || operation.liquidityBps > 10000)
        throw new LiquidityError('invalidAmount')
      operation = { ...operation, liquidity: current.liquidity * BigInt(operation.liquidityBps) / 10000n }
    }
    pool = current.pool
  } else if (!pool.initialized) {
    if (!operation.initialPrice) throw new LiquidityError('invalidPool')
    pool = initializePrice(pool, operation.initialPrice)
  } else if (!original.initialized) throw new LiquidityError('poolChanged')
  const slippageBps =
    'slippageBps' in operation ? (operation.slippageBps ?? defaultLpSlippageBps(pool)) : defaultLpSlippageBps(pool)
  const tolerance = slippagePercent(slippageBps)
  const block = await read('eth_getBlockByNumber', ['latest', false])
  if (!block || typeof block !== 'object' || !('timestamp' in block)) throw new LiquidityError('failed')
  const deadline = hexQuantity(block.timestamp) + LP_DEADLINE_SECONDS
  const adding = operation.kind === 'mint' || operation.kind === 'increase'
  let liquidity = 0n,
    amount0 = 0n,
    amount1 = 0n,
    minimum0 = 0n,
    minimum1 = 0n,
    maximum0 = 0n,
    maximum1 = 0n
  if (operation.kind === 'mint' || operation.kind === 'increase') {
    const lower = operation.kind === 'mint' ? operation.tickLower : operation.position.tickLower,
      upper = operation.kind === 'mint' ? operation.tickUpper : operation.position.tickUpper
    const p = positionFromAmounts(pool, lower, upper, operation.amount0, operation.amount1)
    liquidity = BigInt(p.liquidity.toString())
    if (liquidity <= 0n || liquidity >= 1n << 128n) throw new LiquidityError('invalidAmount')
    amount0 = BigInt(p.mintAmounts.amount0.toString())
    amount1 = BigInt(p.mintAmounts.amount1.toString())
    const slippage = p.mintAmountsWithSlippage(tolerance)
    if (pool.protocol === 'v3') {
      minimum0 = BigInt(slippage.amount0.toString())
      minimum1 = BigInt(slippage.amount1.toString())
      maximum0 = operation.amount0
      maximum1 = operation.amount1
    } else {
      maximum0 = BigInt(slippage.amount0.toString())
      maximum1 = BigInt(slippage.amount1.toString())
      // The entered amounts are spending caps: never expand the user's input to pay for slippage.
      if (maximum0 > operation.amount0 || maximum1 > operation.amount1) {
        const p2 = positionFromAmounts(
          pool,
          lower,
          upper,
          (operation.amount0 * 10000n) / BigInt(10000 + slippageBps),
          (operation.amount1 * 10000n) / BigInt(10000 + slippageBps),
        )
        liquidity = BigInt(p2.liquidity.toString())
        amount0 = BigInt(p2.mintAmounts.amount0.toString())
        amount1 = BigInt(p2.mintAmounts.amount1.toString())
        const max = p2.mintAmountsWithSlippage(tolerance)
        maximum0 = BigInt(max.amount0.toString())
        maximum1 = BigInt(max.amount1.toString())
      }
      if (
        liquidity <= 0n ||
        maximum0 > operation.amount0 ||
        maximum1 > operation.amount1 ||
        maximum0 >= 1n << 128n ||
        maximum1 >= 1n << 128n
      )
        throw new LiquidityError('invalidAmount')
    }
  } else if (operation.kind === 'decrease') {
    liquidity = operation.liquidity
    if (liquidity <= 0n || liquidity > operation.position.liquidity) throw new LiquidityError('invalidAmount')
    const p = positionForLiquidity(pool, operation.position.tickLower, operation.position.tickUpper, liquidity)
    amount0 = BigInt(p.amount0.quotient.toString())
    amount1 = BigInt(p.amount1.quotient.toString())
    const min = p.burnAmountsWithSlippage(tolerance)
    minimum0 = BigInt(min.amount0.toString())
    minimum1 = BigInt(min.amount1.toString())
  } else {
    amount0 = operation.position.claimable0
    amount1 = operation.position.claimable1
  }
  const details = {
    operation,
    owner,
    pool,
    slippageBps,
    deadline,
    liquidity,
    amount0,
    amount1,
    minimum0,
    minimum1,
    maximum0,
    maximum1,
  }
  const manager = liquidityManager(pool.protocol)
  const approvals = adding
    ? [
        { currency: pool.currency0, amount: maximum0 },
        { currency: pool.currency1, amount: maximum1 },
      ]
        .filter((a) => !a.currency.native && a.amount > 0n)
        .map((a) => ({
          ...a,
          spender: pool.protocol === 'v4' ? LP_CONTRACTS.permit2 : manager,
          permit2: pool.protocol === 'v4',
        }))
    : []
  return { ...details, approvals, transaction: buildLiquidityTransaction(details) }
}
