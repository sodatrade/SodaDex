import type { LiquidityPool } from '../src/liquidity/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeAbiParameters, decodeFunctionData, encodeFunctionResult, parseAbiParameters, zeroAddress, type Hex } from 'viem'
import { factoryAbi } from '../src/liquidity/abis'
import { LP_CONTRACTS } from '../src/liquidity/config'
import { buildPoolExactOutput, executePoolExactOutput, getPoolExactOutputQuote, maximumInput, type PoolExactOutputQuote } from '../src/trading/poolExactOutput'
import { routerAbi, v3QuoterAbi, v4QuoterAbi, erc20Abi, permit2Abi } from '../src/trading/abis'
import * as policy from '../src/trading/config'
import { TradeError, type PublicRpc } from '../src/trading/types'
import { hash, owner, selectedPool, tradeFixture } from './poolTradeFixture'
const swap3 = parseAbiParameters('address,uint256,uint256,bytes,bool,uint256[]')
const swap4 = parseAbiParameters('((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)')
const pair = parseAbiParameters('address,uint256')
const review = (protocol: 'v3' | 'v4', native = false, zeroForOne = true): PoolExactOutputQuote<LiquidityPool> => ({
  tradeType: 'exactOutput', pool: selectedPool(protocol, native), zeroForOne, amountOut: 500n, amountIn: 1000n, maximumIn: 1005n, slippageBps: 50,
})
const top = (q: PoolExactOutputQuote<LiquidityPool>) => decodeFunctionData({ abi: routerAbi, data: buildPoolExactOutput(q, owner, 1600n).data }).args
function quotedRead(f: ReturnType<typeof tradeFixture>, amounts: bigint[]): PublicRpc {
  let i = 0
  return async (method, params) => {
    if (method === 'eth_call') {
      const tx = params?.[0] as { to: string; data: Hex }
      const value = amounts[Math.min(i, amounts.length - 1)]
      if (tx.to === policy.CONTRACTS.v3Quoter) { i++; return encodeFunctionResult({ abi: v3QuoterAbi, functionName: 'quoteExactOutputSingle', result: [value, 0n, 0, 0n] }) }
      if (tx.to === policy.CONTRACTS.v4Quoter) { i++; return encodeFunctionResult({ abi: v4QuoterAbi, functionName: 'quoteExactOutputSingle', result: [value, 0n] }) }
    }
    return f.read(method, params)
  }
}
beforeEach(() => { vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(true) })
afterEach(() => vi.restoreAllMocks())
describe('single-pool exact-output amounts and calldata', () => {
  it('rounds maximum input up and uses the shared valid slippage range', () => {
    expect(maximumInput(1001n, 50)).toBe(1007n)
    expect(maximumInput(1n, 1)).toBe(2n)
    expect(maximumInput(1001n, 0)).toBe(1001n)
    for (const bps of [-1, 10000, 0.1, NaN]) expect(() => maximumInput(100n, bps)).toThrow('tradeUnavailable')
    for (const amount of [0n, -1n, 2n ** 128n, 2n ** 128n - 1n]) expect(() => maximumInput(amount, 50)).toThrow('tradeUnavailable')
  })
  it.each(['v3', 'v4'] as const)('quotes registered %s exact output through its fixed Quoter at a numeric block', async (protocol) => {
    const q = review(protocol), f = tradeFixture(q.pool)
    const result = await getPoolExactOutputQuote(q.pool, true, q.amountOut, 50, quotedRead(f, [1001n]))
    expect(result).toMatchObject({ tradeType: 'exactOutput', amountOut: 500n, amountIn: 1001n, maximumIn: 1007n })
    expect(f.read.mock.calls.some(([m, p]) => m === 'eth_call' && p && (p[0] as { to: string }).to === (protocol === 'v3' ? LP_CONTRACTS.factory : LP_CONTRACTS.stateView))).toBe(true)
  })
  it('uses a reversed V3 path and the pinned sixth min-hop field', () => {
    const q = review('v3'), [commands, inputs] = top(q)
    expect(commands).toBe('0x01')
    const [recipient, output, maxInput, path, payer, minHop] = decodeAbiParameters(swap3, inputs[0])
    expect([recipient, output, maxInput, payer, minHop]).toEqual([owner, 500n, 1005n, true, []])
    expect(path.toLowerCase()).toBe(`${q.pool.currency1.address}0001f4${q.pool.currency0.address.slice(2)}`.toLowerCase())
    expect(buildPoolExactOutput(q, owner, 1600n).value).toBe('0x0')
  })
  it('wraps the V3 reviewed maximum and unwraps all unused WOKB to the wallet', () => {
    const q = review('v3', true, false), [commands, inputs] = top(q)
    expect(commands).toBe('0x0b010c04')
    expect(decodeAbiParameters(pair, inputs[0])[1]).toBe(q.maximumIn)
    expect(decodeAbiParameters(pair, inputs[2])).toEqual([owner, 0n])
    expect(BigInt(buildPoolExactOutput(q, owner, 1600n).value)).toBe(q.maximumIn)
    expect(decodeAbiParameters(swap3, inputs[1])[4]).toBe(false)
  })
  it('unwraps the exact native V3 output to the wallet', () => {
    const q = review('v3', true), [commands, inputs] = top(q)
    expect(commands).toBe('0x010c04')
    expect(decodeAbiParameters(pair, inputs[1])).toEqual([owner, q.amountOut])
  })
  it.each([false, true])('V4 exact output settles only the maximum and takes exact output, native=%s', (native) => {
    const q = review('v4', native), [commands, inputs] = top(q)
    expect(commands).toBe('0x1004')
    const [actions, inner] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), inputs[0])
    expect(actions).toBe('0x080c0f')
    expect(decodeAbiParameters(swap4, inner[0])[0].slice(2)).toEqual([500n, 1005n, 0n, '0x'])
    expect(decodeAbiParameters(pair, inner[1])).toEqual([q.pool.currency0.address, q.maximumIn])
    expect(decodeAbiParameters(pair, inner[2])).toEqual([q.pool.currency1.address, q.amountOut])
    expect(BigInt(buildPoolExactOutput(q, owner, 1600n).value)).toBe(native ? q.maximumIn : 0n)
  })
  it('rejects fabricated caps, invalid amounts, direction, owner or expiry before a write', () => {
    const q = review('v3')
    for (const invalid of [{ ...q, maximumIn: 1004n }, { ...q, amountOut: 0n }, { ...q, amountOut: 2n ** 128n }, { ...q, zeroForOne: undefined as unknown as boolean }]) expect(() => buildPoolExactOutput(invalid, owner, 1600n)).toThrow('tradeQuoteChanged')
    expect(() => buildPoolExactOutput(q, zeroAddress, 1600n)).toThrow('tradeQuoteChanged')
    for (const deadline of [0n, -1n, 2n ** 256n]) expect(() => buildPoolExactOutput(q, owner, deadline)).toThrow('tradeQuoteChanged')
  })
  it('refuses a V3 pool when the own Factory resolves a different address', async () => {
    const q = review('v3'), f = tradeFixture(q.pool)
    const read: PublicRpc = async (method, params) => method === 'eth_call' && params && (params[0] as { to: string }).to === LP_CONTRACTS.factory
      ? encodeFunctionResult({ abi: factoryAbi, functionName: 'getPool', result: zeroAddress }) : f.read(method, params)
    await expect(getPoolExactOutputQuote(q.pool, true, 500n, 50, read)).rejects.toThrow()
    expect(f.submitted).toEqual([])
  })
})
describe('reviewed exact-output execution', () => {
  it.each(['v3', 'v4'] as const)('approves only the %s reviewed maximum and keeps original output/cap after a worse quote within it', async (protocol) => {
    const q = review(protocol), f = tradeFixture(q.pool)
    await expect(executePoolExactOutput(q, { ...f.context, read: quotedRead(f, [1000n, 1004n]) })).resolves.toBe(hash)
    expect(f.submitted).toHaveLength(3)
    expect(decodeFunctionData({ abi: erc20Abi, data: f.submitted[0].data }).args?.[1]).toBe(q.maximumIn)
    expect(decodeFunctionData({ abi: permit2Abi, data: f.submitted[1].data }).args?.[2]).toBe(q.maximumIn)
    expect(f.submitted[2].data).toBe(buildPoolExactOutput(q, owner, 1600n).data)
    expect(f.events.at(-1)).toMatchObject({ hash, stage: 'tradeSucceeded', kind: 'swap' })
  })
  it('does not raise the reviewed cap when refreshed required input exceeds it after approvals', async () => {
    const q = review('v3'), f = tradeFixture(q.pool)
    await expect(executePoolExactOutput(q, { ...f.context, read: quotedRead(f, [1000n, 1006n]) })).rejects.toThrow('tradeQuoteChanged')
    expect(f.submitted).toHaveLength(2)
    expect(f.events.some((p) => p.hash === hash && p.kind === 'approval')).toBe(true)
    expect(f.events.some((p) => p.stage === 'tradeSucceeded')).toBe(false)
  })
  it('also rejects an over-cap initial preflight before approvals', async () => {
    const q = review('v3'), f = tradeFixture(q.pool)
    await expect(executePoolExactOutput(q, { ...f.context, read: quotedRead(f, [1006n]) })).rejects.toThrow('tradeQuoteChanged')
    expect(f.submitted).toEqual([])
  })
  it('retains the original exact amount and reviewed cap even when the price improves', async () => {
    const q = review('v3'), f = tradeFixture(q.pool)
    await executePoolExactOutput(q, { ...f.context, read: quotedRead(f, [1000n, 900n]) })
    expect(f.submitted.at(-1)?.data).toBe(buildPoolExactOutput(q, owner, 1600n).data)
  })
  it.each(['account', 'form', 'chain', 'pause'] as const)('stops signing after %s changes during an await', async (change) => {
    const q = review('v3'), f = tradeFixture(q.pool)
    let identity = f.identity, form = true
    const base = quotedRead(f, [1000n])
    const read: PublicRpc = async (method, params) => {
      const result = await base(method, params)
      if (method === 'eth_call') {
        if (change === 'account') identity = { ...identity, revision: 2 }
        if (change === 'chain') identity = { ...identity, chainId: 1 }
        if (change === 'form') form = false
        if (change === 'pause') vi.mocked(policy.publicSwapsEnabled).mockReturnValue(false)
      }
      return result
    }
    await expect(executePoolExactOutput(q, { ...f.context, read, getIdentity: () => identity, isCurrentForm: () => form })).rejects.toThrow(change === 'pause' ? 'tradePaused' : 'tradeIdentityChanged')
    expect(f.submitted).toEqual([])
  })
  it('preserves a pending approval hash and never resumes or rebroadcasts automatically', async () => {
    const q = review('v3'), f = tradeFixture(q.pool)
    await expect(executePoolExactOutput(q, { ...f.context, read: quotedRead(f, [1000n]), wait: async () => { throw new TradeError('tradePending') } })).rejects.toThrow('tradePending')
    expect(f.submitted).toHaveLength(1)
    expect(f.events.at(-1)).toMatchObject({ hash, kind: 'approval', stage: 'tradeConfirming' })
  })
  it('does not submit after its deadline elapses while approvals are confirmed', async () => {
    const q = review('v3'), f = tradeFixture(q.pool)
    const base = quotedRead(f, [1000n]); let blocks = 0
    const read: PublicRpc = async (method, params) => method === 'eth_getBlockByNumber' ? { timestamp: ++blocks === 1 ? '0x3e8' : '0x640' } : base(method, params)
    await expect(executePoolExactOutput(q, { ...f.context, read })).rejects.toThrow('tradeExpired')
    expect(f.submitted).toHaveLength(2)
  })
})
