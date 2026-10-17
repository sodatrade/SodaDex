import { decodeAbiParameters, decodeFunctionData, encodeFunctionResult, parseAbiParameters, zeroAddress, type Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as policy from '../../trading-policy'
import { WOKB_ADDRESS } from '../src/domain/assets'
import { factoryAbi } from '../src/liquidity/abis'
import { LP_CONTRACTS } from '../src/liquidity/config'
import { erc20Abi, permit2Abi, routerAbi, v3QuoterAbi } from '../src/trading/abis'
import { CONTRACTS } from '../src/trading/config'
import { buildPoolSwap, executePoolTrade, getPoolTradeQuote, poolTradeCurrencies } from '../src/trading/poolTrade'
import { TradeError, type PublicRpc } from '../src/trading/types'
import { buildWrap, executeWrap, wrappedNativeAbi } from '../src/trading/wrapping'
import { hash, owner, reviewed, selectedPool, tokenA, tokenB, tradeFixture } from './poolTradeFixture'
beforeEach(() => { vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(true) })
const v3Input = parseAbiParameters('address,uint256,uint256,bytes,bool,uint256[]')
const amountInput = parseAbiParameters('address,uint256')
describe('own-pool single-hop trades', () => {
  it.each(['v3', 'v4'] as const)('executes %s arbitrary token and native routes in both directions', async (protocol) => {
    for (const native of [false, true]) for (const direction of [false, true]) {
      const pool = selectedPool(protocol, native), f = tradeFixture(pool)
      const quote = await getPoolTradeQuote(pool, direction, 1000n, 50, f.read)
      expect(quote.minimumOut).toBe(995n)
      await expect(executePoolTrade(quote, f.context)).resolves.toBe(hash)
      const [input, output] = poolTradeCurrencies(quote)
      expect(f.submitted.length).toBe(input.native ? 1 : 3)
      const tx = f.submitted.at(-1)!
      expect(tx.to).toBe(CONTRACTS.router)
      expect(BigInt(tx.value)).toBe(input.native ? quote.amount : 0n)
      const [commands, inputs, deadline] = decodeFunctionData({ abi: routerAbi, data: tx.data }).args
      expect(deadline).toBe(1600n)
      if (protocol === 'v3') {
        expect(commands).toBe(input.native ? '0x0b000c04' : output.native ? '0x000c04' : '0x00')
        const swap = decodeAbiParameters(v3Input, inputs[input.native ? 1 : 0])
        expect(swap[0]).toBe(output.native ? '0x0000000000000000000000000000000000000002' : owner)
        expect(swap[3].toLowerCase()).toBe(`${input.address}0001f4${output.address.slice(2)}`.toLowerCase())
        expect(swap[4]).toBe(!input.native)
        expect(swap[5]).toEqual([])
      } else {
        expect(commands).toBe('0x1004')
        const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), inputs[0])
        expect(actions).toBe('0x060c0f')
        expect(decodeAbiParameters(amountInput, params[1])).toEqual([input.address, quote.amount])
        expect(decodeAbiParameters(amountInput, params[2])).toEqual([output.address, quote.minimumOut])
      }
      expect(f.events.at(-1)).toMatchObject({ stage: 'tradeSucceeded', hash })
    }
  })
  it('uses exact non-stable token approvals, resetting an insufficient nonzero allowance', async () => {
    const pool = selectedPool('v3'), f = tradeFixture(pool)
    f.setToken(1n)
    await executePoolTrade(reviewed(pool, false), f.context)
    expect(f.submitted).toHaveLength(4)
    expect(f.submitted[0].to).toBe(tokenB.address)
    expect(decodeFunctionData({ abi: erc20Abi, data: f.submitted[0].data }).args).toEqual([CONTRACTS.permit2, 0n])
    expect(decodeFunctionData({ abi: erc20Abi, data: f.submitted[1].data }).args).toEqual([CONTRACTS.permit2, 1000n])
    expect(decodeFunctionData({ abi: permit2Abi, data: f.submitted[2].data }).args).toEqual([tokenB.address, CONTRACTS.router, 1000n, 1600])
    expect(f.wait).toHaveBeenCalledTimes(4)
  })
  it('keeps the reviewed floor when a post-approval quote stays inside the reviewed range', async () => {
    const pool = selectedPool('v3'), f = tradeFixture(pool)
    let quotes = 0
    const read: PublicRpc = async (method, params) => {
      const tx = params?.[0] as { to?: string } | undefined
      if (method === 'eth_call' && tx?.to === CONTRACTS.v3Quoter && ++quotes > 1)
        return encodeFunctionResult({ abi: v3QuoterAbi, functionName: 'quoteExactInputSingle', result: [996n, 0n, 0, 0n] })
      return f.read(method, params)
    }
    await executePoolTrade(reviewed(pool), { ...f.context, read })
    const [, inputs] = decodeFunctionData({ abi: routerAbi, data: f.submitted.at(-1)!.data }).args
    expect(decodeAbiParameters(v3Input, inputs[0])[2]).toBe(995n)
  })
  it('stops after approvals when a refreshed quote drops below the reviewed minimum', async () => {
    const pool = selectedPool('v3'), f = tradeFixture(pool)
    let quotes = 0
    const read: PublicRpc = async (method, params) => {
      const tx = params?.[0] as { to?: string } | undefined
      if (method === 'eth_call' && tx?.to === CONTRACTS.v3Quoter && ++quotes > 1)
        return encodeFunctionResult({ abi: v3QuoterAbi, functionName: 'quoteExactInputSingle', result: [994n, 0n, 0, 0n] })
      return f.read(method, params)
    }
    await expect(executePoolTrade(reviewed(pool), { ...f.context, read })).rejects.toThrow('tradeQuoteChanged')
    expect(f.submitted).toHaveLength(2)
    expect(f.submitted.every((tx) => tx.to !== CONTRACTS.router)).toBe(true)
  })
  it('verifies registration before granting any token allowance', async () => {
    const pool = selectedPool('v3'), f = tradeFixture(pool)
    const read: PublicRpc = async (method, params) => {
      const tx = params?.[0] as { to?: string; data?: Hex } | undefined
      if (method === 'eth_call' && tx?.to === LP_CONTRACTS.factory && tx.data?.startsWith('0x1698ee82'))
        return encodeFunctionResult({ abi: factoryAbi, functionName: 'getPool', result: zeroAddress })
      return f.read(method, params)
    }
    await expect(executePoolTrade(reviewed(pool), { ...f.context, read })).rejects.toThrow('tradeUnsupported')
    expect(f.submitted).toEqual([])
  })
  it('rejects malformed IDs, native aliases, amount and slippage without RPC or wallet writes', async () => {
    const pool = selectedPool('v4'), f = tradeFixture(pool)
    expect(() => buildPoolSwap(reviewed({ ...pool, id: hash }), owner, 1600n)).toThrow('tradeUnsupported')
    expect(() => buildPoolSwap(reviewed({ ...pool, currency0: { ...tokenA, native: true } }), owner, 1600n)).toThrow('tradeUnsupported')
    for (const slippage of [-1, 10000, 0.5]) await expect(getPoolTradeQuote(pool, true, 1000n, slippage, f.read)).rejects.toThrow('tradeUnavailable')
    await expect(getPoolTradeQuote(pool, true, 0n, 50, f.read)).rejects.toThrow('tradeUnavailable')
    expect(f.read).not.toHaveBeenCalled()
    expect(() => buildPoolSwap({ ...reviewed(pool), minimumOut: 994n }, owner, 1600n)).toThrow('tradeQuoteChanged')
  })
  it.each(['account', 'form', 'chain', 'pause'] as const)('stops before a wallet write after %s changes', async (change) => {
    const pool = selectedPool('v3'), f = tradeFixture(pool)
    let current = f.identity, formCurrent = true
    const read: PublicRpc = async (method, params) => {
      const result = await f.read(method, params)
      if (method === 'eth_call') {
        if (change === 'account') current = { ...current, revision: 2 }
        if (change === 'form') formCurrent = false
        if (change === 'chain') current = { ...current, chainId: 1 }
        if (change === 'pause') vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(false)
      }
      return result
    }
    await expect(executePoolTrade(reviewed(pool), { ...f.context, read, getIdentity: () => current, isCurrentForm: () => formCurrent }))
      .rejects.toThrow(change === 'pause' ? 'tradePaused' : 'tradeIdentityChanged')
    expect(f.submitted).toEqual([])
  })
  it('does not rebroadcast when an approval receipt remains pending', async () => {
    const pool = selectedPool('v3'), f = tradeFixture(pool)
    await expect(executePoolTrade(reviewed(pool), { ...f.context, wait: async () => { throw new TradeError('tradePending') } }))
      .rejects.toThrow('tradePending')
    expect(f.submitted).toHaveLength(1)
    expect(f.events.at(-1)).toMatchObject({ hash, kind: 'approval' })
  })
  it('stops when the same-origin RPC is not X Layer', async () => {
    const pool = selectedPool('v3'), f = tradeFixture(pool)
    const read: PublicRpc = async (method, params) => method === 'eth_chainId' ? '0x1' : f.read(method, params)
    await expect(executePoolTrade(reviewed(pool), { ...f.context, read })).rejects.toThrow('tradeUnavailable')
    expect(f.submitted).toHaveLength(0)
  })
})
describe('native OKB wrapping', () => {
  it.each(['wrap', 'unwrap'] as const)('simulates and confirms official WOKB %s without approvals', async (direction) => {
    const f = tradeFixture(selectedPool('v3'))
    await expect(executeWrap({ direction, amount: 1000n }, f.context)).resolves.toBe(hash)
    expect(f.submitted).toHaveLength(1)
    const tx = f.submitted[0]
    expect(tx.to).toBe(WOKB_ADDRESS)
    expect(BigInt(tx.value)).toBe(direction === 'wrap' ? 1000n : 0n)
    expect(decodeFunctionData({ abi: wrappedNativeAbi, data: tx.data })).toMatchObject(
      direction === 'wrap' ? { functionName: 'deposit' } : { functionName: 'withdraw', args: [1000n] })
    expect(f.events.at(-1)).toMatchObject({ hash, stage: 'tradeSucceeded' })
  })
  it('rejects zero amounts and retains the shared simulation and gas balance checks', async () => {
    expect(() => buildWrap({ direction: 'wrap', amount: 0n }, owner)).toThrow('tradeUnavailable')
    const f = tradeFixture(selectedPool('v3'))
    const read: PublicRpc = async (method, params) => method === 'eth_getBalance' ? '0x0' : f.read(method, params)
    await expect(executeWrap({ direction: 'wrap', amount: 1000n }, { ...f.context, read })).rejects.toThrow('tradeGasBalance')
    expect(f.submitted).toEqual([])
  })
})
