import type { Hex } from 'viem'
import { V2 } from '../../../v2-protocol'
import { ensureDirectApproval } from '../trading/directApproval'
import { latestTimestamp } from '../trading/quotes'
import { createExecutionSession, type ExecutionContext } from '../trading/walletExecution'
import { LiquidityError } from './types'
import { encodeV2Liquidity, prepareV2, type V2Preview } from './v2Preview'

export async function executeV2(review: V2Preview, context: ExecutionContext): Promise<Hex> {
  const session = createExecutionSession(context, { requiresPublicSwaps: false })
  const { read, assertCurrent } = session
  if (review.owner.toLowerCase() !== context.identity.address.toLowerCase() ||
    JSON.stringify(encodeV2Liquidity(review)) !== JSON.stringify(review.transaction)) throw new LiquidityError('poolChanged')
  const declared = review.operation.pool
  if (review.pool.address?.toLowerCase() !== declared.address?.toLowerCase() || (review.pool.address && review.pool.address.toLowerCase() !== review.pool.id.toLowerCase())) throw new LiquidityError('poolChanged')
  if (declared.protocol !== 'v2' || review.pool.protocol !== 'v2' || declared.id.toLowerCase() !== review.pool.id.toLowerCase() ||
    [0, 1].some(i => {
      const a = i ? declared.currency1 : declared.currency0, b = i ? review.pool.currency1 : review.pool.currency0
      return a.address.toLowerCase() !== b.address.toLowerCase() || a.native !== b.native || a.decimals !== b.decimals
    })) throw new LiquidityError('poolChanged')
  await session.checkNetwork()
  const refresh = async (): Promise<void> => {
    const latest = await prepareV2(review.operation, review.owner, read)
    assertCurrent()
    if (latest.amount0 < review.minimum0 || latest.amount1 < review.minimum1) throw new LiquidityError('poolChanged')
    if (await latestTimestamp(read) >= review.deadline) throw new LiquidityError('expired')
    assertCurrent()
  }
  await refresh()
  const op = review.operation
  const approvals = op.kind === 'remove' ? [{ token: review.pool.address!, amount: op.liquidity }] :
    [{ token: review.pool.currency0.address, native: review.pool.currency0.native, amount: op.amount0 },
      { token: review.pool.currency1.address, native: review.pool.currency1.native, amount: op.amount1 }].filter(a => !a.native)
  for (const approval of approvals) {
    await ensureDirectApproval(session, review.owner, approval.token, V2.router, approval.amount)
    await refresh()
  }
  const hash = await session.send(review.transaction, 'tradeSending', 'swap')
  context.onProgress({ stage: 'tradeSucceeded', kind: 'swap', hash })
  return hash
}
