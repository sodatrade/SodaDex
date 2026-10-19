import { decodeFunctionResult, encodeFunctionData, parseAbi, type Address, type Hex } from 'viem'
import plan from '../../../../deployments/xlayer-test/active.json'
import { STABLE_ADDRESS, WOKB_ADDRESS } from '../domain/assets'
import { hexQuantity, rpc } from '../lib/rpc'
import { POOLS, V4_POOL_ID } from './config'
import type { PublicRpc } from './types'

const POOL_MANAGER = plan.contracts.v4PoolManager as Address
const STATE_VIEW = plan.contracts.v4StateView as Address
const v3PoolAbi = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)',
])
const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)',
])
const Q96 = 2 ** 96

export interface PoolSnapshot {
  /** USD₮0 per OKB at the pool's current sqrt price, decimals already applied. */
  price: number
  /** OKB held: WOKB in the V3 pool, native OKB in the V4 PoolManager (18 decimals). */
  okb: bigint
  /** USD₮0 held (6 decimals). */
  stable: bigint
}
export interface PoolStats {
  v3: PoolSnapshot
  v4: PoolSnapshot
}

async function tokenBalance(read: PublicRpc, token: Address, owner: Address): Promise<bigint> {
  return hexQuantity(
    await read('eth_call', [{ to: token, data: `0x70a08231${owner.slice(2).toLowerCase().padStart(64, '0')}` }, 'latest']),
  )
}

/** sqrtPriceX96 → token1 per token0 in base units. Floating point is fine: the result is display-only. */
const rawPrice = (sqrtPriceX96: bigint): number => (Number(sqrtPriceX96) / Q96) ** 2

/** Reads both pools' spot price and holdings. Never used for trade amounts. */
export async function getPoolStats(read: PublicRpc = rpc): Promise<PoolStats> {
  const v3Pool = POOLS.v3Address
  if (!POOLS.ready || !v3Pool) throw new Error('Pools are not ready')
  const [v3Slot, v4Slot, v3Okb, v3Stable, v4Okb, v4Stable] = await Promise.all([
    read('eth_call', [{ to: v3Pool, data: encodeFunctionData({ abi: v3PoolAbi, functionName: 'slot0' }) }, 'latest']),
    read('eth_call', [
      {
        to: STATE_VIEW,
        data: encodeFunctionData({ abi: stateViewAbi, functionName: 'getSlot0', args: [V4_POOL_ID] }),
      },
      'latest',
    ]),
    tokenBalance(read, WOKB_ADDRESS, v3Pool),
    tokenBalance(read, STABLE_ADDRESS, v3Pool),
    read('eth_getBalance', [POOL_MANAGER, 'latest']).then(hexQuantity),
    tokenBalance(read, STABLE_ADDRESS, POOL_MANAGER),
  ])
  const [v3Sqrt] = decodeFunctionResult({ abi: v3PoolAbi, functionName: 'slot0', data: v3Slot as Hex })
  const [v4Sqrt] = decodeFunctionResult({ abi: stateViewAbi, functionName: 'getSlot0', data: v4Slot as Hex })
  // V3: token0 USD₮0 (6), token1 WOKB (18) → raw is WOKB-wei per USD₮0 unit.
  const v3Raw = rawPrice(v3Sqrt)
  // V4: currency0 OKB (18), currency1 USD₮0 (6) → raw is USD₮0 units per OKB wei.
  const v4Raw = rawPrice(v4Sqrt)
  return {
    v3: { price: v3Raw > 0 ? 1 / (v3Raw * 1e-12) : 0, okb: v3Okb, stable: v3Stable },
    v4: { price: v4Raw * 1e12, okb: v4Okb, stable: v4Stable },
  }
}

/** Shared query options so the pools and assets pages read one cached snapshot. */
export const poolStatsQuery = () => ({
  queryKey: ['pool-stats'],
  queryFn: () => getPoolStats(),
  enabled: POOLS.ready,
  refetchInterval: 30_000,
  retry: 1,
})
