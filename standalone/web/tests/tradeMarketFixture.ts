import { zeroAddress } from 'viem'
import { WOKB_ADDRESS } from '../src/domain/assets'
import { KNOWN_CURRENCIES } from '../src/liquidity/config'
import type { LiquidityPool } from '../src/liquidity/types'
import { poolId } from '../src/liquidity/pools'
import type { ChartResponse, DexPool } from '../src/features/market/api'
export const marketHash = `0x${'a'.repeat(64)}`
export const marketOwner = '0x1111111111111111111111111111111111111111'
const [native, , stable] = KNOWN_CURRENCIES
export const marketV3: LiquidityPool = { protocol: 'v3', id: '0x3333333333333333333333333333333333333333', address: '0x3333333333333333333333333333333333333333',
  currency0: stable, currency1: { ...native, address: WOKB_ADDRESS }, fee: 100, tickSpacing: 1, sqrtPriceX96: 2n ** 96n, tick: 0, liquidity: 1n, initialized: true }
export const marketV4: LiquidityPool = { ...marketV3, protocol: 'v4', address: undefined, currency0: native, currency1: stable, fee: 0 }
marketV4.id = poolId(marketV4)
export function marketDexPool(p: LiquidityPool): DexPool {
  return { protocol: p.protocol, id: p.id, address: p.address ?? null, token0: p.currency0.address, token1: p.currency1.address, fee: p.fee,
    tickSpacing: p.tickSpacing, hooks: zeroAddress, source: 'chain', createdBlock: 73361037, sqrtPriceX96: p.sqrtPriceX96.toString(),
    tick: p.tick, liquidity: p.liquidity.toString(), stateError: null }
}
export function chartFixture(p: LiquidityPool = marketV3, overrides: Partial<ChartResponse> = {}): ChartResponse {
  const forward = p.protocol === 'v4', price = forward ? '200' : '0.008', sqrt = (2n ** 96n).toString()
  const volume0 = forward ? '8000000000000000' : '1000000', volume1 = forward ? '1000000' : '8000000000000000'
  return { schemaVersion: 1, chainId: 196, asOf: { number: 73365037, hash: marketHash, timestamp: 1700001000 },
    coverage: { fromBlock: 73361037, toBlock: 73365037, complete: true, nextFromBlock: null }, pool: marketDexPool(p),
    token0: { address: p.currency0.address, symbol: p.currency0.symbol, name: p.currency0.name, decimals: p.currency0.decimals },
    token1: { address: p.currency1.address, symbol: p.currency1.symbol, name: p.currency1.name, decimals: p.currency1.decimals },
    interval: '5m', query: { fromBlock: 73361037, toBlock: 73365037 }, priceToken1PerToken0: price, priceUnavailableReason: null,
    candles: [{ time: 1700000100, bucketEndTime: 1700000400, open: price, high: price, low: price, close: price,
      sqrtPriceOpenX96: sqrt, sqrtPriceHighX96: sqrt, sqrtPriceLowX96: sqrt, sqrtPriceCloseX96: sqrt,
      volume0Raw: volume0, volume1Raw: volume1, tradeCount: 1, firstBlock: 73362000, lastBlock: 73362000 }],
    trades: [{ id: `${marketHash}:0`, blockNumber: 73362000, blockHash: marketHash, transactionHash: marketHash, logIndex: 0, timestamp: 1700000101,
      amount0Raw: volume0, amount1Raw: `-${volume1}`, volume0Raw: volume0, volume1Raw: volume1, sqrtPriceX96: sqrt,
      priceToken1PerToken0: price, sender: marketOwner, recipient: marketOwner }], queryComplete: true, nextCursor: null, ...overrides }
}
