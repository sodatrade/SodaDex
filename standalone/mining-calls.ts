import { decodeFunctionData, encodeFunctionData, parseAbi, type Abi, type Hex } from 'viem'
import { MINING_PRODUCT_READ_ABI, MINING_PRODUCT_WRITE_ABI } from './mining-abi'
import type { MiningAddress, MiningContractIdentity, MiningProductDeployment } from './mining-products'

export const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
export type MiningReadRole = keyof typeof MINING_PRODUCT_READ_ABI
export type MiningWriteRole = keyof typeof MINING_PRODUCT_WRITE_ABI
export interface MiningTarget { identity: MiningContractIdentity; read?: MiningReadRole; write?: MiningWriteRole }
export interface MiningTransaction { from: MiningAddress; to: MiningAddress; data: Hex; value: Hex }
export const sameMiningAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export function miningTargets(d: MiningProductDeployment): MiningTarget[] {
  const base = Object.entries(d.contracts).map(([role, identity]): MiningTarget => ({ identity,
    read: role in MINING_PRODUCT_READ_ABI ? role as MiningReadRole : undefined,
    write: role in MINING_PRODUCT_WRITE_ABI ? role as MiningWriteRole : role === 'fab' ? 'token' : undefined }))
  return [...base, ...base.flatMap((t): MiningTarget[] => t.identity.beacon ? [{ identity: {
    address: t.identity.beacon.address, runtimeKeccak256: t.identity.beacon.runtimeKeccak256,
  }, read: 'beacon' }] : []),
    ...d.projects.flatMap((p): MiningTarget[] => [
    { identity: p.token, read: 'projectToken', write: 'token' }, { identity: p.vault, read: 'projectVault', write: 'projectVault' },
    { identity: p.holder, read: 'holder', write: 'holder' }, ...(p.pair ? [{ identity: p.pair, read: 'pair' as const, write: 'token' as const }] : []),
  ])]
}

export function miningAbi(role: MiningReadRole | MiningWriteRole, mode: 'read' | 'write'): Abi {
  const signatures = mode === 'read' ? MINING_PRODUCT_READ_ABI[role as MiningReadRole] : MINING_PRODUCT_WRITE_ABI[role as MiningWriteRole]
  return parseAbi(signatures)
}

function canonical(abi: Abi, data: Hex): { functionName: string; args: readonly unknown[] } | undefined {
  try {
    const decoded = decodeFunctionData({ abi, data })
    if (encodeFunctionData({ abi, functionName: decoded.functionName, args: decoded.args }).toLowerCase() !== data.toLowerCase()) return
    return { functionName: decoded.functionName, args: decoded.args ?? [] }
  } catch { return }
}

const address = (v: unknown): v is MiningAddress => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)
const positive = (v: unknown): v is bigint => typeof v === 'bigint' && v > 0n && v < (1n << 256n) - 1n

/** Restrict simulations to the same fixed destinations the wallet UI can submit. */
export function validMiningProductCall(value: unknown, d: MiningProductDeployment, write: boolean, now = Math.floor(Date.now() / 1000)): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const tx = value as Record<string, unknown>
  if (Object.keys(tx).some((k) => !(write ? ['from', 'to', 'data', 'value'] : ['to', 'data']).includes(k)) ||
      !address(tx.to) || typeof tx.data !== 'string' || !/^0x[0-9a-fA-F]+$/.test(tx.data) || tx.data.length > 4098) return false
  const target = miningTargets(d).find((entry) => sameMiningAddress(entry.identity.address, tx.to as string))
  if (!target) return false
  if (!write) return !!target.read && !!canonical(miningAbi(target.read, 'read'), tx.data as Hex)
  if (!address(tx.from) || (tx.value !== undefined && (typeof tx.value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(tx.value))) || !target.write) return false
  const nativeValue = BigInt(String(tx.value ?? '0x0'))
  const decoded = canonical(miningAbi(target.write, 'write'), tx.data as Hex)
  if (!decoded) return false
  const { functionName: name, args: a } = decoded, c = d.contracts
  const is = (v: unknown, expected: string): boolean => typeof v === 'string' && sameMiningAddress(v, expected)
  const project = (v: unknown): boolean => d.projects.some((p) => is(v, p.token.address))
  const vault = (v: unknown): boolean => d.projects.some((p) => is(v, p.vault.address))
  const pair = (v: unknown): boolean => d.projects.some((p) => p.pair && is(v, p.pair.address))
  const deadline = (v: unknown): boolean => typeof v === 'bigint' && v >= BigInt(now) && v <= BigInt(now + 3600)
  if (target.write === 'minerBuyer') return name === 'buy' && typeof a[0] === 'bigint' && typeof a[1] === 'bigint' && positive(a[2]) && nativeValue === a[2]
  if (target.write === 'circuitMarket') return false
  if (target.write === 'router' && name === 'swapExactETHForTokens') return nativeValue > 0n && positive(a[0]) && Array.isArray(a[1]) &&
    a[1].length === 2 && is(a[1][0], c.wrappedNative.address) && is(a[1][1], c.fab.address) && is(a[2], tx.from) && deadline(a[3])
  if (nativeValue !== 0n) return false
  if (name === 'approve') {
    if (target.write === 'circuits') return is(a[0], c.fragmentVault.address) && typeof a[1] === 'bigint'
    const spenders = is(tx.to, c.fab.address) ? [c.fragmentPool.address, c.manager.address, c.router.address, c.liquidityHelper.address]
      : is(tx.to, c.fragmentVault.address) ? [c.fragmentPool.address]
      : d.projects.some((p) => p.pair && is(tx.to, p.pair.address)) ? [c.liquidityHelper.address]
      : [c.manager.address, c.router.address, c.liquidityHelper.address, ...d.projects.filter((p) => is(tx.to, p.token.address)).map((p) => p.holder.address)]
    return spenders.some((s) => is(a[0], s)) && typeof a[1] === 'bigint' && a[1] >= 0n && a[1] < (1n << 256n) - 1n
  }
  if (name === 'claimFor') return is(a[0], tx.from)
  if (name === 'claim' && target.write === 'v2Locker') return is(a[0], c.fab.address) || project(a[0])
  if (name === 'harvest' && target.write === 'v2Locker') return pair(a[0])
  if (['harvest', 'claim', 'syncPaid', 'harvestAndClaim', 'sync', 'fundFarm'].includes(name)) return a.length === 0
  if (name === 'syncVault' || name === 'claimForVault') return vault(a[0])
  if (name === 'syncHistory') return typeof a[0] === 'bigint' && a[0] > 0n && a[0] <= 16n
  if (name === 'burnForBoost') return positive(a[0])
  if (name === 'deposit' || name === 'redeem') return typeof a[0] === 'bigint' && positive(a[1])
  if (name === 'buy' || name === 'sell') return project(a[0]) && positive(a[1]) && positive(a[2])
  if (name === 'swapExactIn') return typeof a[0] === 'boolean' && positive(a[1]) && positive(a[2]) && deadline(a[3])
  if (name === 'swapExactTokensForTokensSupportingFeeOnTransferTokens') return positive(a[0]) && positive(a[1]) &&
    Array.isArray(a[2]) && a[2].length === 2 && ((is(a[2][0], c.fab.address) && project(a[2][1])) ||
      (project(a[2][0]) && is(a[2][1], c.fab.address))) && is(a[3], tx.from) && deadline(a[4])
  if (name === 'addLiquidity') return target.write === 'fragmentPool'
    ? a.slice(0, 4).every(positive) && deadline(a[4]) : project(a[0]) && a.slice(1, 5).every(positive) && deadline(a[5])
  if (name === 'removeLiquidity') return target.write === 'fragmentPool'
    ? a.slice(0, 3).every(positive) && deadline(a[3]) : project(a[0]) && a.slice(1, 4).every(positive) && deadline(a[4])
  return false
}
