import { createPublicClient, http, encodeFunctionData, keccak256, toHex, zeroAddress, type Address, type Hex } from 'viem'
import type { FragmentDeployment } from './config'
import { poolAbi, lpRewardsAbi, tokenAbi } from './abi'
export type FragmentClient = ReturnType<typeof makeClient>
export const makeClient = (config: FragmentDeployment) => createPublicClient({ transport: http(config.rpcUrl, { retryCount: 1 }) })
export interface PreparedTransaction { to: Address; data: Hex; value: bigint; label: string; account: Address; chainId: number }
export async function verifyDeployment(c: FragmentClient, d: FragmentDeployment): Promise<{ rewards: Address }> {
  if (await c.getChainId() !== d.chainId) throw new Error('RPC chain mismatch')
  const [version, shares, policy, rewards] = await Promise.all([
    c.readContract({ address: d.pool, abi: poolAbi, functionName: 'PRODUCT_VERSION' }),
    c.readContract({ address: d.pool, abi: poolAbi, functionName: 'VAULT' }),
    c.readContract({ address: d.pool, abi: poolAbi, functionName: 'POLICY' }),
    c.readContract({ address: d.pool, abi: poolAbi, functionName: 'REWARDS' }),
  ])
  const same = (a: Address, b: Address): boolean => a.toLowerCase() === b.toLowerCase()
  if (version !== keccak256(toHex('SodaDEX.OKB.Fragments.v2')) || !same(shares, d.vault) || !same(policy, d.policy)) throw new Error('Unexpected contract version or bindings')
  const rp = await c.readContract({ address: rewards, abi: lpRewardsAbi, functionName: 'POOL' })
  if (!same(rp, d.pool)) throw new Error('LP reward pool mismatch')
  return { rewards }
}
export async function readSnapshot(c: FragmentClient, d: FragmentDeployment, user?: Address) {
  const identity = await verifyDeployment(c, d)
  const account = user ?? zeroAddress
  const [shares, okb, lpSupply, shareBalance, lpBalance, okbBalance] = await Promise.all([
    c.readContract({ address: d.pool, abi: poolAbi, functionName: 'reserveShares' }),
    c.readContract({ address: d.pool, abi: poolAbi, functionName: 'reserveOkb' }),
    c.readContract({ address: d.pool, abi: poolAbi, functionName: 'totalSupply' }),
    c.readContract({ address: d.vault, abi: tokenAbi, functionName: 'balanceOf', args: [account] }),
    c.readContract({ address: d.pool, abi: tokenAbi, functionName: 'balanceOf', args: [account] }),
    c.getBalance({ address: account }),
  ])
  return { ...identity, shares, okb, lpSupply, shareBalance, lpBalance, okbBalance }
}
export type Snapshot = Awaited<ReturnType<typeof readSnapshot>>
export function minimum(amount: bigint, bps: number): bigint {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps >= 10000) throw new Error('Invalid slippage')
  return amount * BigInt(10000 - bps) / 10000n
}
export async function approveIfNeeded(c: FragmentClient, token: Address, owner: Address, spender: Address, amount: bigint): Promise<{ to: Address; data: Hex } | undefined> {
  const allowance = await c.readContract({ address: token, abi: tokenAbi, functionName: 'allowance', args: [owner, spender] })
  if (allowance >= amount) return undefined
  return { to: token, data: encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [spender, amount] }) }
}
