import { encodeFunctionData, type Address } from 'viem'
import { tokenAbi } from '../liquidity/abis'
import { call } from '../liquidity/rpc'
import { TradeError } from './types'
import type { ExecutionSession } from './walletExecution'

/** Router02 pulls ERC20 directly. Never grant it Permit2 or unlimited allowances. */
export async function ensureDirectApproval(session: ExecutionSession, owner: Address, token: Address, spender: Address, amount: bigint): Promise<void> {
  if (amount <= 0n || amount >= 2n ** 160n - 1n) throw new TradeError('tradeUnavailable')
  const existing = await call(tokenAbi, token, 'allowance', [owner, spender], session.read) as bigint
  session.assertCurrent()
  if (existing >= amount) return
  for (const approval of existing ? [0n, amount] : [amount]) {
    await session.send({ from: owner, to: token, value: '0x0',
      data: encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [spender, approval] }) },
    approval ? 'tradeTokenApproval' : 'tradeResetApproval', 'approval')
    session.assertCurrent()
  }
  const approved = await call(tokenAbi, token, 'allowance', [owner, spender], session.read) as bigint
  session.assertCurrent()
  if (approved < amount) throw new TradeError('tradeFailed')
}
