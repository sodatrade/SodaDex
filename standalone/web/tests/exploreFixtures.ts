import { zeroAddress } from 'viem'
import { STABLE_ADDRESS, WOKB_ADDRESS } from '../src/domain/assets'
import type { ReferencePool, ReferencePools, ReferenceToken } from '../src/features/explore/referenceApi'
export const referenceToken: ReferenceToken = { chainId: 196, address: STABLE_ADDRESS, symbol: 'USD₮0', name: 'USD₮0', decimals: 6, logoURI: null, metadataSource: 'chain', metadataError: null }
export const referenceOther: ReferenceToken = { ...referenceToken, address: WOKB_ADDRESS, symbol: 'WOKB', name: 'Wrapped OKB', decimals: 18 }
export const referencePool: ReferencePool = { protocol: 'v3', id: '0x1111111111111111111111111111111111111111', address: '0x1111111111111111111111111111111111111111', source: 'uniswap', readOnly: true,
  token0: referenceToken, token1: referenceOther, fee: 500, tickSpacing: 10, hooks: zeroAddress, sqrtPriceX96: '1', tick: 1, liquidity: '1000', reserves: { token0Raw: '1000', token1Raw: '1000' }, priceToken1PerToken0: '0.01', stateError: null }
export const referencePools: ReferencePools = { schemaVersion: 1, chainId: 196, source: 'uniswap', readOnly: true,
  asOf: { number: 10, hash: `0x${'a'.repeat(64)}`, timestamp: 1 }, pools: [referencePool], errors: [] }
