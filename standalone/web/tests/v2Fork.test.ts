import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import testTokenArtifact from '../node_modules/@uniswap/v2-core/build/ERC20.json'
import { encodeAbiParameters, encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from 'viem'
import { V2, V2_PAIR } from '../../v2-protocol'
import { KNOWN_CURRENCIES, NATIVE_CURRENCY } from '../src/liquidity/config'
import { tokenAbi } from '../src/liquidity/abis'
import { call } from '../src/liquidity/rpc'
import { discoverV2, getV2Position } from '../src/liquidity/v2Pools'
import { encodeV2Liquidity, prepareV2 } from '../src/liquidity/v2Preview'
import { executeV2 } from '../src/liquidity/v2Execution'
import { v2Minimum } from '../src/liquidity/v2Math'
import type { Currency, PublicRpc } from '../src/liquidity/types'
import { getPoolTradeQuote, executePoolTrade } from '../src/trading/poolTrade'
import { getPoolExactOutputQuote, executePoolExactOutput } from '../src/trading/poolExactOutput'
import * as policy from '../src/trading/config'
import { startLiquidityFork } from './liquidityForkFixture'
import { installV2Fixture } from './v2ForkFixture'
const owner = '0x6ecf746b078d46391f8C425B150153212F7C0545' as Address
const fixturePath = process.env.SODADEX_LP_FORK_STATE, runtimes = process.env.SODADEX_V2_RUNTIMES
let fixture: Awaited<ReturnType<typeof startLiquidityFork>>
const read: PublicRpc = (method, params) => fixture.request(method, params)
const provider = { request: ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => method === 'eth_accounts' ? Promise.resolve([owner]) : fixture.request(method, params) }
const identity = { address: owner, provider, chainId: 196, revision: 1 }
const submitted = new Set<Hex>()
const context = { identity, getIdentity: () => identity, isCurrentForm: () => true, onProgress: (p: { hash?: Hex }) => { if (p.hash) submitted.add(p.hash) }, read }
const stable = KNOWN_CURRENCIES[2]
describe.runIf(Boolean(fixturePath && runtimes))('canonical V2 owned offline chain', () => {
  beforeAll(async () => {
    vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(true)
    fixture = await startLiquidityFork({ fixturePath: fixturePath!, stateViewCodePath: process.env.SODADEX_LP_STATEVIEW_CODE })
    await installV2Fixture(fixture.request, runtimes!, owner)
  }, 20000)
  afterAll(() => fixture?.stop())
  it('creates and adds, trades both ways/exact output, removes half and all user LP', async () => {
    expect(await call(tokenAbi, stable.address, 'balanceOf', [owner], read)).toBeGreaterThanOrEqual(200n)
    let pool = await discoverV2(NATIVE_CURRENCY, stable, read)
    expect(pool.id).toBe(zeroAddress)
    const amounts = (a: bigint, b: bigint) => pool.currency0.native ? { amount0: a, amount1: b } : { amount0: b, amount1: a }
    await executeV2(await prepareV2({ kind: 'add', pool, ...amounts(10n ** 14n, 100n), slippageBps: 50 }, owner, read), context)
    pool = await discoverV2(NATIVE_CURRENCY, stable, read)
    expect(pool.address).toBeDefined()
    expect(await call(V2_PAIR, pool.address!, 'balanceOf', [zeroAddress], read)).toBe(1000n)
    const first = await getV2Position(pool, owner, read)
    const add = await prepareV2({ kind: 'add', pool, ...amounts(2n * 10n ** 14n, 100n), slippageBps: 50 }, owner, read)
    const native = pool.currency0.native ? add.amount0 : add.amount1
    expect(native).toBe(10n ** 14n) // excess desired native is refunded
    const previousHashes = new Set(submitted)
    const before = BigInt(await read('eth_getBalance', [owner, 'latest']) as Hex)
    await executeV2(add, context)
    let gas = 0n
    for (const hash of submitted) if (!previousHashes.has(hash)) {
      const receipt = await read('eth_getTransactionReceipt', [hash]) as { gasUsed: Hex; effectiveGasPrice: Hex }
      gas += BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)
    }
    const after = BigInt(await read('eth_getBalance', [owner, 'latest']) as Hex)
    expect(before - after - gas).toBe(native)
    expect((await getV2Position(pool, owner, read)).balance).toBeGreaterThan(first.balance)
    for (const input of [NATIVE_CURRENCY, stable] as Currency[]) {
      pool = await discoverV2(NATIVE_CURRENCY, stable, read)
      const direction = input.native === pool.currency0.native
      const quote = await getPoolTradeQuote(pool, direction, input.native ? 10n ** 13n : 10n, 50, read)
      expect(quote.amountOut).toBeGreaterThan(0n)
      await executePoolTrade(quote, context)
      const outputQuote = await getPoolExactOutputQuote(pool, direction, input.native ? 1n : 10n ** 8n, 50, read)
      await executePoolExactOutput(outputQuote, context)
    }
    for (const half of [true, false]) {
      const position = await getV2Position(pool, owner, read)
      const remove = await prepareV2({ kind: 'remove', pool, liquidity: half ? position.balance / 2n : position.balance, slippageBps: 50 }, owner, read)
      expect(remove.amount0).toBeGreaterThan(0n); expect(remove.amount1).toBeGreaterThan(0n)
      await executeV2(remove, context)
    }
    expect((await getV2Position(pool, owner, read)).balance).toBe(0n)
    expect(await call(V2_PAIR, pool.address!, 'totalSupply', [], read)).toBe(1000n)
    expect(await read('eth_getBalance', [V2.router, 'latest'])).toBe('0x0')
  }, 60000)
  it('rejects a swapped preview pool before approval or any wallet transaction', async () => {
    const pool = await discoverV2(NATIVE_CURRENCY, stable, read)
    const review = await prepareV2({ kind: 'add', pool, amount0: 1000n, amount1: 10n ** 14n, slippageBps: 50 }, owner, read)
    const request = vi.spyOn(provider, 'request')
    await expect(executeV2({ ...review, pool: { ...pool, address: stable.address } }, context)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
    request.mockRestore()
  })
  it('keeps a positive minimum for a one-raw-unit withdrawal', () => { expect(v2Minimum(1n, 50)).toBe(1n) })
  it('keeps ERC20/ERC20 principal redeemable when the standard protocol-fee switch is enabled', async () => {
    const checkpoint = await fixture.request('evm_snapshot')
    try {
      const tokens: Currency[] = []
      for (const symbol of ['LOCAL-A', 'LOCAL-B']) {
        const data = `0x${testTokenArtifact.bytecode}${encodeAbiParameters([{ type: 'uint256' }], [10n ** 24n]).slice(2)}`
        const hash = await fixture.request('eth_sendTransaction', [{ from: owner, data }])
        await fixture.request('evm_mine')
        const receipt = await read('eth_getTransactionReceipt', [hash]) as { status: string; contractAddress: Address }
        expect(receipt.status).toBe('0x1')
        tokens.push({ address: receipt.contractAddress, symbol, name: symbol, native: false, decimals: 18 })
      }
      const feeRecipient = '0x1111111111111111111111111111111111111111'
      await fixture.request('eth_sendTransaction', [{ from: owner, to: V2.factory, data: encodeFunctionData({ abi: parseAbi(['function setFeeTo(address)']), functionName: 'setFeeTo', args: [feeRecipient] }) }])
      await fixture.request('evm_mine')
      let pool = await discoverV2(tokens[0], tokens[1], read)
      await executeV2(await prepareV2({ kind: 'add', pool, amount0: 10n ** 20n, amount1: 10n ** 20n, slippageBps: 50 }, owner, read), context)
      pool = await discoverV2(tokens[0], tokens[1], read)
      expect(pool.feeOn).toBe(true); expect(pool.kLast).toBeGreaterThan(0n)
      for (const direction of [true, false]) {
        await executePoolTrade(await getPoolTradeQuote(pool, direction, 10n ** 19n, 50, read), context)
        await executePoolExactOutput(await getPoolExactOutputQuote(pool, direction, 10n ** 16n, 50, read), context)
      }
      const position = await getV2Position(pool, owner, read)
      const review = await prepareV2({ kind: 'remove', pool, liquidity: position.balance, slippageBps: 0 }, owner, read)
      const before = await Promise.all([pool.currency0, pool.currency1].map(c => call(tokenAbi, c.address, 'balanceOf', [owner], read) as Promise<bigint>))
      await executeV2(review, context)
      const after = await Promise.all([pool.currency0, pool.currency1].map(c => call(tokenAbi, c.address, 'balanceOf', [owner], read) as Promise<bigint>))
      expect([after[0] - before[0], after[1] - before[1]]).toEqual([review.amount0, review.amount1])
      expect(await call(V2_PAIR, pool.address!, 'balanceOf', [feeRecipient], read)).toBeGreaterThan(0n)
      expect((await getV2Position(pool, owner, read)).balance).toBe(0n)
    } finally { await fixture.request('evm_revert', [checkpoint]) }
  }, 90000)
  it('stops an expired preview or wallet change before sending an approval', async () => {
    const pool = await discoverV2(NATIVE_CURRENCY, stable, read)
    const review = await prepareV2({ kind: 'add', pool, amount0: 1000n, amount1: 10n ** 14n, slippageBps: 50 }, owner, read)
    const request = vi.spyOn(provider, 'request')
    const expired = { ...review, deadline: 1n }
    await expect(executeV2({ ...expired, transaction: encodeV2Liquidity(expired) }, context)).rejects.toThrow('expired')
    await expect(executeV2(review, { ...context, getIdentity: () => ({ ...identity, revision: 2 }) })).rejects.toThrow('tradeIdentityChanged')
    expect(request).not.toHaveBeenCalled()
    request.mockRestore()
  })
})
