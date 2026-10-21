import { describe, expect, it, vi } from 'vitest'
import { discoverV2 } from '../src/liquidity/v2Pools'
import { NATIVE_CURRENCY } from '../src/liquidity/config'
import { v2Quote } from '../src/trading/v2Trade'
import type { V2Pool } from '../src/liquidity/v2Types'

describe('standard V2 asset boundary', () => {
  it('never quotes gross output as net receipt for the known 1% tax token', async () => {
    const token = { address: '0xc9e6CFEFB3433B1b46d3FA61E096ABB519fFE7E0' as const, symbol: 'TEST-FAB196', name: 'Legacy taxed token', decimals: 18, native: false }
    const read = vi.fn()
    await expect(discoverV2(token, NATIVE_CURRENCY, read)).rejects.toThrow()
    const pool: V2Pool = { protocol: 'v2', currency0: token, currency1: NATIVE_CURRENCY, id: token.address,
      fee: 3000, reserve0: 100n, reserve1: 100n, totalSupply: 100n, kLast: 0n, feeOn: false, initialized: true }
    for (const exactOutput of [false, true])
      for (const direction of [false, true])
        await expect(v2Quote(pool, direction, 100n, exactOutput, read)).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
  })
})
