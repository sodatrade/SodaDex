import { decodeFunctionResult, encodeFunctionData, type Address, type Hex } from 'viem'
import { STABLE_ADDRESS } from '../domain/assets'
import { erc20Abi, permit2Abi } from './abis'
import { CONTRACTS } from './config'
import { TradeError, type PublicRpc, type TradeStage } from './types'
export interface ApprovalContext {
  owner: Address
  /** The legacy USD₮0 route remains the default for existing callers. */
  token?: Address
  amount: bigint
  expiry: bigint
  read: PublicRpc
  assertCurrent: () => void
  send: (to: Address, data: Hex, stage: TradeStage) => Promise<void>
}
async function tokenAllowance(c: ApprovalContext): Promise<bigint> {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'allowance', args: [c.owner, CONTRACTS.permit2] })
  const result = await c.read('eth_call', [{ to: c.token ?? STABLE_ADDRESS, data }, 'latest'])
  c.assertCurrent()
  return decodeFunctionResult({ abi: erc20Abi, functionName: 'allowance', data: result as Hex })
}
export async function permitAllowance(c: ApprovalContext): Promise<{ amount: bigint; expiration: bigint }> {
  const data = encodeFunctionData({
    abi: permit2Abi,
    functionName: 'allowance',
    args: [c.owner, c.token ?? STABLE_ADDRESS, CONTRACTS.router],
  })
  const result = await c.read('eth_call', [{ to: CONTRACTS.permit2, data }, 'latest'])
  c.assertCurrent()
  const [amount, expiration] = decodeFunctionResult({ abi: permit2Abi, functionName: 'allowance', data: result as Hex })
  return { amount, expiration: BigInt(expiration) }
}
/** Exact spend only. USDT-compatible zero reset is required if an existing nonzero allowance is insufficient. */
export async function ensureApprovals(c: ApprovalContext): Promise<bigint> {
  const token = c.token ?? STABLE_ADDRESS
  if (c.amount <= 0n || c.amount >= 2n ** 160n - 1n || c.expiry <= 0n || c.expiry >= 2n ** 48n - 1n)
    throw new TradeError('tradeUnavailable')
  let allowed = await tokenAllowance(c)
  if (allowed < c.amount) {
    if (allowed > 0n) {
      await c.send(
        token,
        encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [CONTRACTS.permit2, 0n] }),
        'tradeResetApproval',
      )
      if ((await tokenAllowance(c)) !== 0n) throw new TradeError('tradeFailed')
    }
    await c.send(
      token,
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
        args: [token, CONTRACTS.router, c.amount, Number(c.expiry)],
      }),
      'tradePermitApproval',
    )
    permit = await permitAllowance(c)
    if (permit.amount < c.amount || permit.expiration < c.expiry) throw new TradeError('tradeFailed')
  }
  return permit.expiration
}
