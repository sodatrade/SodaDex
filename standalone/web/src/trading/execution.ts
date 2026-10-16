import { type Address, type Hex } from 'viem'
import { ensureApprovals } from './approvals'
import { DEADLINE_SECONDS, POOLS } from './config'
import { buildSwap } from './encoding'
import { latestTimestamp, quoteRoute } from './quotes'
import { TradeError, type Quote, type TradeStage } from './types'
import { createExecutionSession, type ExecutionContext } from './walletExecution'
export { identityGuard } from './walletExecution'
export type { ExecutionContext } from './walletExecution'

export async function executeTrade(review: Quote, c: ExecutionContext): Promise<Hex> {
  const { read, assertCurrent, progress, send, checkNetwork } = createExecutionSession(c)
  if (!(c.ready ?? POOLS.ready)) throw new TradeError('tradeNotReady')
  progress('tradePreparing')
  await checkNetwork()
  let deadline = (await latestTimestamp(read)) + DEADLINE_SECONDS
  assertCurrent()
  if (review.from === 'usdt0') {
    const expiration = await ensureApprovals({
      owner: c.identity.address,
      amount: review.amount,
      expiry: deadline,
      read,
      assertCurrent,
      send: async (to: Address, data: Hex, stage: TradeStage) => {
        await send({ from: c.identity.address, to, data, value: '0x0' }, stage, 'approval')
      },
    })
    assertCurrent()
    deadline = deadline < expiration ? deadline : expiration
  }
  progress('tradeRefreshing')
  const refreshed = await quoteRoute(review, review.protocol, read)
  assertCurrent()
  if (refreshed.amountOut < review.minimumOut) throw new TradeError('tradeQuoteChanged')
  // The user's reviewed minimum is a floor across all subsequent quotes and approvals.
  const finalQuote = {
    ...refreshed,
    minimumOut: refreshed.minimumOut > review.minimumOut ? refreshed.minimumOut : review.minimumOut,
  }
  const timestamp = await latestTimestamp(read)
  assertCurrent()
  if (timestamp >= deadline) throw new TradeError('tradeExpired')
  const tx = buildSwap(finalQuote, c.identity.address, deadline)
  progress('tradeSimulating')
  const hash = await send(tx, 'tradeSending', 'swap')
  c.onProgress({ stage: 'tradeSucceeded', hash, kind: 'swap' })
  return hash
}
