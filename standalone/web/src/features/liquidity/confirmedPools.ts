import { CHAIN_ID } from '../../domain/assets'
import { LP_CONTRACTS } from '../../liquidity'
import type { LiquidityPool } from '../../liquidity/types'

// Only successful LP operations produce these live factory-verified candidates.
// React Query owns this session cache; the persistent directory remains authoritative
// for discovery. Quote/execution adapters still recheck every candidate on chain.
export const confirmedPoolsKey = ['liquidity', 'confirmed-pools', CHAIN_ID, LP_CONTRACTS.factory, LP_CONTRACTS.poolManager] as const
export function mergeConfirmedPools(indexed: readonly LiquidityPool[], confirmed: readonly LiquidityPool[]): LiquidityPool[] {
  const result = new Map(confirmed.map(pool => [`${pool.protocol}:${pool.id.toLowerCase()}`, pool]))
  for (const pool of indexed) result.set(`${pool.protocol}:${pool.id.toLowerCase()}`, pool)
  return [...result.values()]
}
