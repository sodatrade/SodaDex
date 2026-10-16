import { decodeFunctionResult, encodeFunctionData, type Address, type Hex } from 'viem'
import { STABLE_ADDRESS } from '../domain/assets'
import { erc20Abi, permit2Abi } from './abis'
import { CONTRACTS } from './config'
import { TradeError, type PublicRpc, type TradeStage } from './types'
export interface ApprovalContext {
  owner: Address
  amount: bigint
  expiry: bigint
  read: PublicRpc
  assertCurrent: () => void
  send: (to: Address, data: Hex, stage: TradeStage) => Promise<void>
}
async function tokenAllowance(c: ApprovalContext): Promise<bigint> {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'allowance', args: [c.owner, CONTRACTS.permit2] })
  const result = await c.read('eth_call', [{ to: STABLE_ADDRESS, data }, 'latest'])
  c.assertCurrent()
  return decodeFunctionResult({ abi: erc20Abi, functionName: 'allowance', data: result as Hex })
}
export async function permitAllowance(c: ApprovalContext): Promise<{ amount: bigint; expiration: bigint }> {
  const data = encodeFunctionData({
    abi: permit2Abi,
    functionName: 'allowance',
    args: [c.owner, STABLE_ADDRESS, CONTRACTS.router],
  })
  const result = await c.read('eth_call', [{ to: CONTRACTS.permit2, data }, 'latest'])
  c.assertCurrent()
  const [amount, expiration] = decodeFunctionResult({ abi: permit2Abi, functionName: 'allowance', data: result as Hex })
  return { amount, expiration: BigInt(expiration) }
}
/** Exact spend only. USDT-compatible zero reset is required if an existing nonzero allowance is insufficient. */
export async function ensureApprovals(c: ApprovalContext): Promise<bigint> {
  let allowed = await tokenAllowance(c)
  if (allowed < c.amount) {
    if (allowed > 0n) {
      await c.send(
        STABLE_ADDRESS,
        encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [CONTRACTS.permit2, 0n] }),
        'tradeResetApproval',
      )
      if ((await tokenAllowance(c)) !== 0n) throw new TradeError('tradeFailed')
    }
    await c.send(
      STABLE_ADDRESS,
      encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [CONTRACTS.permit2, c.amount] }),
      'tradeTokenApproval',
    )
    allowed = await tokenAllowance(c)
    if (allowed < c.amount) throw new TradeError('tradeFailed')
  }
  let permit = await permitAllowance(c)
  if (permit.amount < c.amount || permit.expiration < c.expiry) {
    await c.send(
      CONTRACTS.permit2,
      encodeFunctionData({
        abi: permit2Abi,
        functionName: 'approve',
        args: [STABLE_ADDRESS, CONTRACTS.router, c.amount, Number(c.expiry)],
      }),
      'tradePermitApproval',
    )
    permit = await permitAllowance(c)
    if (permit.amount < c.amount || permit.expiration < c.expiry) throw new TradeError('tradeFailed')
  }
  return permit.expiration
}
