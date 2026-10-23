import { zeroAddress, type Address } from 'viem'
import deployment from '../../../../deployments/xlayer-test/active.json'
import { ASSETS, CHAIN_ID, WOKB_ADDRESS } from '../domain/assets'
import type { Currency, LiquidityPool } from './types'
export const LP_CHAIN_ID = CHAIN_ID
export const LP_CONTRACTS = {
  factory: deployment.contracts.v3Factory as Address,
  v3Manager: deployment.contracts.v3PositionManager as Address,
  v4Manager: deployment.contracts.v4PositionManager as Address,
  stateView: deployment.contracts.v4StateView as Address,
  poolManager: deployment.contracts.v4PoolManager as Address,
  permit2: deployment.permit2 as Address,
} as const
export const KNOWN_CURRENCIES: readonly Currency[] = ASSETS.map((a) => ({
  address: a.address ?? zeroAddress,
  symbol: a.symbol,
  name: a.name,
  decimals: a.decimals,
  native: a.address === null,
}))
export const NATIVE_CURRENCY = KNOWN_CURRENCIES[0]
// Upstream apps/web/src/constants/misc.ts default: ten minutes.
export const LP_DEADLINE_SECONDS = 600n
export function defaultLpSlippageBps(pool: Pick<LiquidityPool, 'protocol' | 'currency0' | 'currency1'>): number {
  return pool.protocol === 'v4' && (pool.currency0.native || pool.currency1.native) ? 5 : 250
}
export function protocolCurrency(currency: Currency, protocol: 'v3' | 'v4'): Currency {
  return protocol === 'v3' && currency.native ? { ...currency, address: WOKB_ADDRESS } : currency
}
