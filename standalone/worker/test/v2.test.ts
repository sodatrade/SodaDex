import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbiParameters, toEventSelector, zeroAddress, type Hex } from 'viem'
import { V2, V2_PAIR_EVENTS, V2_ROUTER } from '../../v2-protocol'
import { v2Request } from '../src/v2-requests'
import { chartTrade } from '../src/dex-chart-source'
import type { ChainLog, Pool } from '../src/dex-data'
import { reserveSqrt } from '../src/v2-data'
const a = `0x${'11'.repeat(20)}` as Hex, b = `0x${'22'.repeat(20)}` as Hex, owner = `0x${'33'.repeat(20)}` as Hex
const base = { from: owner, to: V2.router, value: 0n }
const deadline = 12345n
describe('canonical V2 Router admission', () => {
  it('admits creation/deposits/removal with self-recipient and bounded minimums', () => {
    for (const [functionName, args, value] of [
      ['addLiquidity', [a, b, 100n, 200n, 99n, 198n, owner, deadline], 0n],
      ['addLiquidityETH', [a, 100n, 99n, 198n, owner, deadline], 200n],
      ['removeLiquidity', [a, b, 100n, 1n, 1n, owner, deadline], 0n],
      ['removeLiquidityETH', [a, 100n, 1n, 1n, owner, deadline], 0n],
    ] as const) {
      const data = encodeFunctionData({ abi: V2_ROUTER, functionName, args })
      expect(v2Request(base.to, data, owner, value)?.kind).toBe(functionName.startsWith('add') ? 'add' : 'remove')
    }
  })
  it('admits the six single-pair swap modes with correct native endpoints', () => {
    for (const [functionName, args, value] of [
      ['swapExactTokensForTokens', [100n, 1n, [a, b], owner, deadline], 0n],
      ['swapTokensForExactTokens', [1n, 100n, [a, b], owner, deadline], 0n],
      ['swapExactETHForTokens', [1n, [V2.wrapped, a], owner, deadline], 100n],
      ['swapETHForExactTokens', [1n, [V2.wrapped, a], owner, deadline], 100n],
      ['swapExactTokensForETH', [100n, 1n, [a, V2.wrapped], owner, deadline], 0n],
      ['swapTokensForExactETH', [1n, 100n, [a, V2.wrapped], owner, deadline], 0n],
    ] as const) expect(v2Request(V2.router, encodeFunctionData({ abi: V2_ROUTER, functionName, args }), owner, value)?.kind).toBe('swap')
  })
  it('rejects foreign router, recipient, extra hops, trailing data, zero minimum and native mismatch', () => {
    const encode = (path: readonly Hex[] = [a, b], recipient: Hex = owner, min = 1n): Hex => encodeFunctionData({ abi: V2_ROUTER,
      functionName: 'swapExactTokensForTokens', args: [100n, min, path, recipient, deadline] })
    for (const data of [encode([a, b, V2.wrapped]), encode([a, a]), encode([a, zeroAddress]), encode([a, b], b), encode([a, b], owner, 0n), `${encode()}00` as Hex])
      expect(v2Request(V2.router, data, owner, 0n)).toBeNull()
    expect(v2Request(a, encode(), owner, 0n)).toBeNull()
    expect(v2Request(V2.router, encode(), owner, 1n)).toBeNull()
    const native = encodeFunctionData({ abi: V2_ROUTER, functionName: 'swapExactETHForTokens', args: [1n, [a, b], owner, deadline] })
    expect(v2Request(V2.router, native, owner, 100n)).toBeNull()
  })
})
describe('V2 reserve-backed chart', () => {
  const hash = `0x${'44'.repeat(32)}` as Hex
  const block = { number: 100, hash, timestamp: 1000 }
  const pool: Pool = { protocol: 'v2', id: a, address: a, token0: a, token1: b, fee: 3000, tickSpacing: 0, hooks: zeroAddress,
    createdBlock: 99, source: 'chain', sqrtPriceX96: null, tick: null, liquidity: null, stateError: null }
  const token0 = { address: a, symbol: 'A', name: 'A', decimals: 8 }, token1 = { address: b, symbol: 'B', name: 'B', decimals: 18 }
  const sync: ChainLog = { address: a, blockNumber: '0x64', blockHash: hash, transactionHash: hash, logIndex: '0x1',
    topics: [toEventSelector(V2_PAIR_EVENTS[3])], data: encodeAbiParameters(parseAbiParameters('uint112,uint112'), [100000000n, 2000000000000000000n]) }
  const swap: ChainLog = { ...sync, logIndex: '0x2', topics: encodeEventTopics({ abi: V2_PAIR_EVENTS, eventName: 'Swap', args: { sender: owner, to: owner } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(parseAbiParameters('uint256,uint256,uint256,uint256'), [100n, 0n, 0n, 10n]) }
  it('uses the preceding same-transaction Sync and adjusts decimals', () => {
    const trade = chartTrade(swap, block, pool, token0, token1, sync)
    expect(Number(trade.priceToken1PerToken0)).toBeCloseTo(2, 12)
    expect(trade.priceSource).toBe('v2-reserves'); expect(trade.amount1Raw).toBe('-10')
    expect(trade.volume0Raw).toBe('100')
    expect(reserveSqrt(1n, 1n)).toBe(String(2n ** 96n))
  })
  it('rejects missing, unrelated, non-adjacent or zero reserve Sync', () => {
    for (const prior of [undefined, { ...sync, address: b }, { ...sync, transactionHash: `0x${'55'.repeat(32)}` as Hex }, { ...sync, logIndex: '0x0' as Hex },
      { ...sync, data: encodeAbiParameters(parseAbiParameters('uint112,uint112'), [0n, 0n]) }])
      expect(() => chartTrade(swap, block, pool, token0, token1, prior)).toThrow()
  })
})
