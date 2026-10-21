export * from './types'
export { NATIVE_CURRENCY, KNOWN_CURRENCIES, LP_CONTRACTS, defaultLpSlippageBps } from './config'
export { fullRange } from './math'
export { importCurrency } from './currencies'
export { discoverPool, refreshPool, listPools } from './pools'
export { getPosition, listPositions } from './positions'
export { prepareLiquidity } from './preview'
export { executeLiquidity, liquidityError, recheckLiquidityReceipt } from './execution'
export function liquidityForBps(liquidity: bigint, bps: number): bigint {
  if (liquidity < 0n || !Number.isInteger(bps) || bps < 0 || bps > 10000)
    throw new RangeError('Invalid liquidity percentage')
  return (liquidity * BigInt(bps)) / 10000n
}
