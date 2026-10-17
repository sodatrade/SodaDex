import { NETWORK } from '../network'
import { hexQuantity, rpc } from './readRpc'

/** A 1952 build served by a 196 Worker is unavailable, even if both nodes respond. */
export async function getProfileNetworkStatus(): Promise<{ block: bigint }> {
  const response = await fetch('/api/network', { signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error('Network profile unavailable')
  const value: unknown = await response.json()
  if (typeof value !== 'object' || value === null || !('id' in value) || value.id !== NETWORK.id ||
    !('chainId' in value) || value.chainId !== NETWORK.chainId ||
    !('dexEnabled' in value) || value.dexEnabled !== NETWORK.dexEnabled ||
    !('ordersEnabled' in value) || value.ordersEnabled !== NETWORK.ordersEnabled ||
    !('referenceEnabled' in value) || value.referenceEnabled !== NETWORK.referenceEnabled)
    throw new Error('Mismatched frontend and Worker network profiles')
  if (hexQuantity(await rpc('eth_chainId')) !== BigInt(NETWORK.chainId)) throw new Error('Wrong RPC chain')
  return { block: hexQuantity(await rpc('eth_blockNumber')) }
}
