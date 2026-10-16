import { describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, encodeFunctionResult, zeroAddress } from 'viem'
import type { LiquidityPool } from '../src/liquidity/types'
import { getPoolQuote } from '../src/trading/poolQuotes'
import { v3QuoterAbi, v4QuoterAbi } from '../src/trading/abis'
import type { PublicRpc } from '../src/trading/types'
const currency0 = { address: '0x1111111111111111111111111111111111111111' as const, symbol: 'A', name: 'Token A', decimals: 18, native: false }
const currency1 = { ...currency0, address: '0x2222222222222222222222222222222222222222' as const, symbol: 'B', decimals: 6 }
const pool: LiquidityPool = { protocol: 'v3', id: currency0.address, address: currency0.address, currency0, currency1,
  fee: 500, tickSpacing: 10, sqrtPriceX96: 2n ** 96n, tick: 0, liquidity: 10n, initialized: true }
describe('quotes for self-created pools', () => {
  it('quotes arbitrary own V3 assets in reverse with the actual fee at a pinned block', async () => {
    const read = vi.fn<PublicRpc>().mockResolvedValueOnce('0xc4').mockResolvedValueOnce('0x10')
      .mockResolvedValueOnce(encodeFunctionResult({ abi: v3QuoterAbi, functionName: 'quoteExactInputSingle', result: [99n, 0n, 0, 100n] }))
    expect(await getPoolQuote(pool, false, 100n, read)).toBe(99n)
    const [, args] = read.mock.calls[2]
    const tx = args?.[0] as { data: `0x${string}` }
    expect(decodeFunctionData({ abi: v3QuoterAbi, data: tx.data }).args[0]).toMatchObject({ tokenIn: currency1.address, tokenOut: currency0.address, fee: 500, amountIn: 100n })
    expect(args?.[1]).toBe('0x10')
  })
  it('quotes an initialized native V4 key without creating a wallet transaction', async () => {
    const read = vi.fn<PublicRpc>().mockResolvedValueOnce('0xc4').mockResolvedValueOnce('0x10')
      .mockResolvedValueOnce(encodeFunctionResult({ abi: v4QuoterAbi, functionName: 'quoteExactInputSingle', result: [12n, 100n] }))
    const v4: LiquidityPool = { ...pool, protocol: 'v4', currency0: { ...currency0, address: zeroAddress, native: true } }
    expect(await getPoolQuote(v4, true, 100n, read)).toBe(12n)
    const tx = read.mock.calls[2][1]?.[0] as { data: `0x${string}` }
    expect(decodeFunctionData({ abi: v4QuoterAbi, data: tx.data }).args[0]).toMatchObject({ poolKey: { currency0: zeroAddress, fee: 500, tickSpacing: 10, hooks: zeroAddress }, exactAmount: 100n, zeroForOne: true })
    expect(read.mock.calls.every(([method]) => method !== 'eth_estimateGas')).toBe(true)
    await expect(getPoolQuote({ ...v4, initialized: false }, true, 100n, read)).rejects.toThrow('Invalid quote amount')
  })
})
