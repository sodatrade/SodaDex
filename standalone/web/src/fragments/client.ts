import { createPublicClient, http, encodeFunctionData, keccak256, toHex, zeroAddress, type Address, type Hex } from 'viem'
import type { FragmentDeployment } from './config'
import { poolAbi, lpRewardsAbi, tokenAbi, ignixIncomeAbi, mirrorVaultAbi } from './abi'
export type FragmentClient = ReturnType<typeof makeClient>
export const makeClient = (config: FragmentDeployment) => createPublicClient({ transport: http(config.rpcUrl, { retryCount: 1 }) })
export interface PreparedTransaction { to: Address; data: Hex; value: bigint; label: string; account: Address; chainId: number }
export async function verifyDeployment(c: FragmentClient, d: FragmentDeployment): Promise<{ rewards: Address; preciseLiquidity: boolean; mirrorVault: boolean }> {
  if (await c.getChainId() !== d.chainId) throw new Error('RPC chain mismatch')
  const [version, shares, policy, rewards] = await Promise.all([
    c.readContract({ address: d.pool, abi: poolAbi, functionName: 'PRODUCT_VERSION' }),
    c.readContract({ address: d.pool, abi: poolAbi, functionName: 'VAULT' }),
    c.readContract({ address: d.pool, abi: poolAbi, functionName: 'POLICY' }),
    c.readContract({ address: d.pool, abi: poolAbi, functionName: 'REWARDS' }),
  ])
  const same = (a: Address, b: Address): boolean => a.toLowerCase() === b.toLowerCase()
  // Product revision v4 is still the special constant-product pool, not Uniswap V4.
  // The epoch pool binds IGNIX MirrorVault; it keeps the v4 income contract and precise liquidity.
  const mirrorVault = version === keccak256(toHex('SodaDEX.OKB.MirrorEpochPool.v1'))
  const ignixIncome = mirrorVault || version === keccak256(toHex('SodaDEX.OKB.Fragments.v4'))
  const preciseLiquidity = ignixIncome || version === keccak256(toHex('SodaDEX.OKB.Fragments.v3'))
  if ((!preciseLiquidity && version !== keccak256(toHex('SodaDEX.OKB.Fragments.v2'))) || !same(shares, d.vault) || !same(policy, d.policy)) throw new Error('Unexpected contract version or bindings')
  if (ignixIncome) {
    if (!d.income || !d.ignixTreasury) throw new Error('Missing IGNIX income binding')
    const [income, fab, incomePool, incomeFab, recipient] = await Promise.all([
      c.readContract({ address: d.pool, abi: poolAbi, functionName: 'INCOME' }),
      c.readContract({ address: d.pool, abi: poolAbi, functionName: 'FAB' }),
      c.readContract({ address: d.income, abi: ignixIncomeAbi, functionName: 'POOL' }),
      c.readContract({ address: d.income, abi: ignixIncomeAbi, functionName: 'FAB' }),
      c.readContract({ address: d.income, abi: ignixIncomeAbi, functionName: 'RECIPIENT' }),
    ])
    if (!same(income, d.income) || !same(incomePool, d.pool) || !same(incomeFab, fab) || !same(recipient, d.ignixTreasury)) throw new Error('IGNIX income binding mismatch')
  } else if (d.income || d.ignixTreasury) throw new Error('Income binding requires the IGNIX pool revision')
  const rp = await c.readContract({ address: rewards, abi: lpRewardsAbi, functionName: 'POOL' })
  if (!same(rp, d.pool)) throw new Error('LP reward pool mismatch')
  if (mirrorVault) {
    const [lpPool, rewardsVersion, vaultPolicy] = await Promise.all([
      c.readContract({ address: d.vault, abi: mirrorVaultAbi, functionName: 'LP_POOL' }),
      c.readContract({ address: d.vault, abi: mirrorVaultAbi, functionName: 'LP_REWARDS_VERSION' }),
      c.readContract({ address: d.vault, abi: mirrorVaultAbi, functionName: 'POLICY' }),
    ])
    if (!same(lpPool, d.pool) || rewardsVersion !== keccak256(toHex('SodaDEX.MirrorEpochRewards.v1')) || !same(vaultPolicy, d.policy)) throw new Error('MirrorVault binding mismatch')
  }
  return { rewards, preciseLiquidity, mirrorVault }
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
  // MirrorVault reports zero backing while its daily books are stale; the pool then refuses swaps and adds.
  const [eligibleWeight, vaultClaimable] = identity.mirrorVault ? await Promise.all([
    c.readContract({ address: d.vault, abi: mirrorVaultAbi, functionName: 'totalEligibleWeight' }),
    c.readContract({ address: d.vault, abi: mirrorVaultAbi, functionName: 'claimable', args: [account] }),
  ]) : [undefined, undefined]
  const tradingPaused = eligibleWeight === 0n
  return { ...identity, shares, okb, lpSupply, shareBalance, lpBalance, okbBalance, tradingPaused, vaultClaimable }
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
