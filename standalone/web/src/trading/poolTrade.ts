import { V2 } from '../../../v2-protocol'
import { ensureDirectApproval } from './directApproval'
import { type Address, type Hex } from 'viem'
import { CHAIN_ID } from '../domain/assets'
import { refreshPool } from '../liquidity/pools'
import type { AnyPool } from '../liquidity/v2Types'
import { hexQuantity, rpc } from '../lib/rpc'
import { ensureApprovals } from './approvals'
import { DEADLINE_SECONDS, SLIPPAGE_BPS } from './config'
import { minimumOutput } from './encoding'
import { buildPoolSwap } from './poolTradeEncoding'
import { getPoolQuote } from './poolQuotes'
import { latestTimestamp } from './quotes'
import { TradeError, type PublicRpc } from './types'
import { createExecutionSession, type ExecutionContext } from './walletExecution'

import { assertTradePool, poolTradeCurrencies } from './poolTradeValidation'
import type { PoolTradeQuote } from './poolTradeTypes'
export { poolTradeCurrencies } from './poolTradeValidation'
export type { PoolTradeQuote } from './poolTradeTypes'
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export async function getPoolTradeQuote(
  pool: AnyPool,
  zeroForOne: boolean,
  amount: bigint,
  slippageBps = Number(SLIPPAGE_BPS),
  read: PublicRpc = rpc,
): Promise<PoolTradeQuote> {
  assertTradePool(pool)
  minimumOutput(1n, slippageBps)
  if (typeof zeroForOne !== 'boolean' || amount <= 0n || amount >= 2n ** 128n)
    throw new TradeError('tradeUnavailable')
  if (hexQuantity(await read('eth_chainId')) !== BigInt(CHAIN_ID)) throw new TradeError('tradeUnavailable')
  // A caller-supplied pool object is never sufficient registration evidence.
  const verified = await refreshPool(pool, read)
  assertTradePool(verified)
  if (!same(verified.id, pool.id)) throw new TradeError('tradeQuoteChanged')
  const amountOut = await getPoolQuote(verified, zeroForOne, amount, read)
  return { pool: verified, zeroForOne, amount, amountOut, minimumOut: minimumOutput(amountOut, slippageBps), slippageBps }
}
export { buildPoolSwap }

/** Refreshes the same reviewed pool after finite approvals and retains the reviewed minimum. */
export async function executePoolTrade(review: PoolTradeQuote, c: ExecutionContext): Promise<Hex> {
  const session = createExecutionSession(c)
  const { read, assertCurrent, progress, send } = session
  buildPoolSwap(review, c.identity.address, 1n)
  progress('tradePreparing')
  const preflight = await getPoolTradeQuote(review.pool, review.zeroForOne, review.amount, review.slippageBps, read)
  assertCurrent()
  if (preflight.amountOut < review.minimumOut) throw new TradeError('tradeQuoteChanged')
  let deadline = (await latestTimestamp(read)) + DEADLINE_SECONDS
  assertCurrent()
  const [input] = poolTradeCurrencies(review)
  if (!input.native && review.pool.protocol === 'v2') {
    await ensureDirectApproval(session, c.identity.address, input.address, V2.router, review.amount)
  } else if (!input.native) {
    const expiration = await ensureApprovals({
      owner: c.identity.address, token: input.address, amount: review.amount, expiry: deadline, read, assertCurrent,
      send: async (to: Address, data: Hex, stage) => {
        await send({ from: c.identity.address, to, data, value: '0x0' }, stage, 'approval')
      },
    })
    assertCurrent()
    deadline = deadline < expiration ? deadline : expiration
  }
  progress('tradeRefreshing')
  const refreshed = await getPoolTradeQuote(review.pool, review.zeroForOne, review.amount, review.slippageBps, read)
  assertCurrent()
  if (refreshed.amountOut < review.minimumOut) throw new TradeError('tradeQuoteChanged')
  const finalQuote = { ...refreshed, minimumOut: refreshed.minimumOut > review.minimumOut ? refreshed.minimumOut : review.minimumOut }
  const timestamp = await latestTimestamp(read)
  assertCurrent()
  if (timestamp >= deadline) throw new TradeError('tradeExpired')
  progress('tradeSimulating')
  const hash = await send(buildPoolSwap(finalQuote, c.identity.address, deadline), 'tradeSending', 'swap')
  c.onProgress({ stage: 'tradeSucceeded', hash, kind: 'swap' })
  return hash
}
