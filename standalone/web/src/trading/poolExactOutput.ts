import { V2 } from '../../../v2-protocol'
import { ensureDirectApproval } from './directApproval'
import { v2Quote } from './v2Trade'
import { decodeFunctionResult, encodeFunctionData, toHex, type Address, type Hex } from 'viem'
import { CHAIN_ID } from '../domain/assets'
import { refreshPool, poolKey } from '../liquidity/pools'
import type { AnyPool } from '../liquidity/v2Types'
import { hexQuantity, rpc } from '../lib/rpc'
import { v3QuoterAbi, v4QuoterAbi } from './abis'
import { ensureApprovals } from './approvals'
import { CONTRACTS, DEADLINE_SECONDS, SLIPPAGE_BPS } from './config'
import { maximumInput } from './exactOutputMath'
import { buildPoolExactOutput } from './poolExactOutputEncoding'
import type { PoolExactOutputQuote } from './poolExactOutputTypes'
import { assertTradePool, poolTradeCurrencies } from './poolTradeValidation'
import { latestTimestamp } from './quotes'
import { TradeError, type PublicRpc } from './types'
import { createExecutionSession, type ExecutionContext } from './walletExecution'
export { maximumInput } from './exactOutputMath'
export { buildPoolExactOutput } from './poolExactOutputEncoding'
export type { PoolExactOutputQuote } from './poolExactOutputTypes'

/** Revalidates the selected own pool, then asks its fixed Quoter for input needed for exact output. */
export async function getPoolExactOutputQuote(
  pool: AnyPool, zeroForOne: boolean, amountOut: bigint,
  slippageBps = Number(SLIPPAGE_BPS), read: PublicRpc = rpc,
): Promise<PoolExactOutputQuote> {
  assertTradePool(pool)
  maximumInput(1n, slippageBps)
  if (typeof zeroForOne !== 'boolean' || amountOut <= 0n || amountOut >= 2n ** 128n)
    throw new TradeError('tradeUnavailable')
  if (hexQuantity(await read('eth_chainId')) !== BigInt(CHAIN_ID)) throw new TradeError('tradeUnavailable')
  const verified = await refreshPool(pool, read)
  assertTradePool(verified)
  if (verified.id.toLowerCase() !== pool.id.toLowerCase()) throw new TradeError('tradeQuoteChanged')
  const block = toHex(hexQuantity(await read('eth_blockNumber')))
  let amountIn: bigint
  if (verified.protocol === 'v2') {
    amountIn = await v2Quote(verified, zeroForOne, amountOut, true, read, block)
  } else if (verified.protocol === 'v3') {
    const [input, output] = poolTradeCurrencies({ pool: verified, zeroForOne })
    const data = encodeFunctionData({ abi: v3QuoterAbi, functionName: 'quoteExactOutputSingle', args: [{
      tokenIn: input.address, tokenOut: output.address, amount: amountOut, fee: verified.fee, sqrtPriceLimitX96: 0n,
    }] })
    amountIn = decodeFunctionResult({ abi: v3QuoterAbi, functionName: 'quoteExactOutputSingle',
      data: await read('eth_call', [{ to: CONTRACTS.v3Quoter, data }, block]) as Hex })[0]
  } else {
    const data = encodeFunctionData({ abi: v4QuoterAbi, functionName: 'quoteExactOutputSingle', args: [{
      poolKey: poolKey(verified), zeroForOne, exactAmount: amountOut, hookData: '0x',
    }] })
    amountIn = decodeFunctionResult({ abi: v4QuoterAbi, functionName: 'quoteExactOutputSingle',
      data: await read('eth_call', [{ to: CONTRACTS.v4Quoter, data }, block]) as Hex })[0]
  }
  return { tradeType: 'exactOutput', pool: verified, zeroForOne, amountOut, amountIn,
    maximumIn: maximumInput(amountIn, slippageBps), slippageBps }
}

/** Standard non-FOT/non-rebasing assets only. The reviewed exact output and maximum spend never change. */
export async function executePoolExactOutput(review: PoolExactOutputQuote, c: ExecutionContext): Promise<Hex> {
  const session = createExecutionSession(c)
  const { read, assertCurrent, progress, send } = session
  buildPoolExactOutput(review, c.identity.address, 1n)
  progress('tradePreparing')
  const refresh = async (): Promise<void> => {
    const fresh = await getPoolExactOutputQuote(review.pool, review.zeroForOne, review.amountOut, review.slippageBps, read)
    assertCurrent()
    if (fresh.amountIn > review.maximumIn) throw new TradeError('tradeQuoteChanged')
  }
  await refresh()
  let deadline = (await latestTimestamp(read)) + DEADLINE_SECONDS
  assertCurrent()
  const [input] = poolTradeCurrencies(review)
  if (!input.native && review.pool.protocol === 'v2') {
    await ensureDirectApproval(session, c.identity.address, input.address, V2.router, review.maximumIn)
  } else if (!input.native) {
    const expiration = await ensureApprovals({ owner: c.identity.address, token: input.address,
      amount: review.maximumIn, expiry: deadline, read, assertCurrent,
      send: async (to: Address, data: Hex, stage) => { await send({ from: c.identity.address, to, data, value: '0x0' }, stage, 'approval') },
    })
    assertCurrent()
    deadline = deadline < expiration ? deadline : expiration
  }
  progress('tradeRefreshing')
  await refresh()
  const timestamp = await latestTimestamp(read)
  assertCurrent()
  if (timestamp >= deadline) throw new TradeError('tradeExpired')
  progress('tradeSimulating')
  const hash = await send(buildPoolExactOutput(review, c.identity.address, deadline), 'tradeSending', 'swap')
  c.onProgress({ stage: 'tradeSucceeded', hash, kind: 'swap' })
  return hash
}
