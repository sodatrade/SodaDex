import { getAddress, isAddress, type Address } from 'viem'
import { NETWORK } from '../network'
export interface FragmentDeployment {
  chainId: number
  vault: Address
  pool: Address
  policy: Address
  fromBlock: bigint
  rpcUrl: string
}
/** Build-time public manifest. Never selects production contracts from URL/localStorage. */
export function parseDeployment(raw: string | undefined): FragmentDeployment | undefined {
  if (!raw) return undefined
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object') throw new Error('Invalid fragment deployment')
  const v = value as Record<string, unknown>
  if (v.chainId !== NETWORK.chainId) throw new Error('Fragment deployment chain mismatch')
  const address = (key: string): Address => {
    if (typeof v[key] !== 'string' || !isAddress(v[key]) || BigInt(v[key]) === 0n) throw new Error(`Invalid ${key}`)
    return getAddress(v[key])
  }
  if (typeof v.fromBlock !== 'string' || !/^\d+$/.test(v.fromBlock)) throw new Error('Invalid deployment block')
  // Local fixture transport is only allowed for a local page. Public builds use the configured chain RPC.
  const local = typeof window !== 'undefined' && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
  let rpcUrl = typeof window !== 'undefined' ? new URL('/api/fragments/rpc', window.location.origin).href : '/api/fragments/rpc'
  if (v.rpcUrl !== undefined) {
    if (typeof v.rpcUrl !== 'string') throw new Error('Invalid RPC')
    const u = new URL(v.rpcUrl)
    if (!local || !['127.0.0.1', 'localhost'].includes(u.hostname) || u.protocol !== 'http:') throw new Error('Local fixture RPC only')
    rpcUrl = u.href
  }
  return { chainId: NETWORK.chainId, vault: address('vault'), pool: address('pool'), policy: address('policy'), fromBlock: BigInt(v.fromBlock), rpcUrl }
}
export function deploymentState(): { deployment?: FragmentDeployment; error?: string } {
  try { return { deployment: parseDeployment(import.meta.env.VITE_SODADEX_FRAGMENTS_DEPLOYMENT) } }
  catch (e) { return { error: e instanceof Error ? e.message : 'Invalid deployment' } }
}

export function deploymentKey(d: FragmentDeployment | undefined): string { return d ? `${d.chainId}:${d.pool}:${d.vault}:${d.policy}:${d.rpcUrl}:${d.fromBlock.toString()}` : 'unconfigured' }
