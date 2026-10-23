import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { zeroAddress, type Address, type Hex } from 'viem'
import { WOKB_ADDRESS } from '../src/domain/assets'
import { tokenAbi } from '../src/liquidity/abis'
import { discoverPool, listPools } from '../src/liquidity/pools'
import { KNOWN_CURRENCIES } from '../src/liquidity/config'
import { executeLiquidity } from '../src/liquidity/execution'
import { fullRange } from '../src/liquidity/math'
import { prepareLiquidity } from '../src/liquidity/preview'
import { call } from '../src/liquidity/rpc'
import { executePoolTrade, getPoolTradeQuote, poolTradeCurrencies } from '../src/trading/poolTrade'
import { executeWrap } from '../src/trading/wrapping'
import { CONTRACTS } from '../src/trading/config'
import type { PublicRpc, TradeIdentity } from '../src/trading/types'
import { startLiquidityFork } from './liquidityForkFixture'
const fixturePath = process.env.SODADEX_LP_FORK_STATE
const runtimePath = process.env.SODADEX_TRADE_RUNTIMES
const owner = '0x6ecf746b078d46391f8C425B150153212F7C0545' as Address
let fixture: Awaited<ReturnType<typeof startLiquidityFork>>
let snapshot: unknown
const read: PublicRpc = (method, params) => fixture.request(method, params)
const identity: TradeIdentity = { address: owner, chainId: 196, revision: 1,
  provider: { request: ({ method, params }) => method === 'eth_accounts' ? Promise.resolve([owner]) : fixture.request(method, params) } }
const context = { identity, getIdentity: () => identity, isCurrentForm: () => true, onProgress: () => {}, read }
const balance = async (address: Address): Promise<bigint> => address === zeroAddress
  ? BigInt(await read('eth_getBalance', [owner, 'latest']) as string)
  : await call(tokenAbi, address, 'balanceOf', [owner], read) as bigint
describe.runIf(Boolean(fixturePath && runtimePath))('owned local chain-196 discovered-pool swaps', () => {
  beforeAll(async () => {
    fixture = await startLiquidityFork({ fixturePath: fixturePath!, stateViewCodePath: process.env.SODADEX_LP_STATEVIEW_CODE })
    const runtime = JSON.parse(await readFile(runtimePath!, 'utf8')) as { chainId: number; contracts: { address: Address; code: string }[] }
    if (runtime.chainId !== 196) throw Error('Chain-196 runtime fixture required')
    for (const address of [CONTRACTS.v3Quoter, CONTRACTS.v4Quoter]) {
      const contract = runtime.contracts.find((c) => c.address.toLowerCase() === address.toLowerCase())
      if (!contract || !/^0x[0-9a-f]+$/i.test(contract.code) || contract.code.length < 4) throw Error('Quoter runtime fixture required')
      await fixture.request('anvil_setCode', [address, contract.code])
    }
    snapshot = await fixture.request('evm_snapshot')
  }, 20000)
  beforeEach(async () => {
    expect(await fixture.request('evm_revert', [snapshot])).toBe(true)
    snapshot = await fixture.request('evm_snapshot')
  })
  afterAll(() => fixture?.stop())
  it.each(['v3', 'v4'] as const)('%s executes both native/token directions with a mined output transfer', async (protocol) => {
    const pool = (await listPools(read)).find((p) => p.protocol === protocol)!
    for (const zeroForOne of [true, false]) {
      const [input, output] = poolTradeCurrencies({ pool, zeroForOne })
      const quote = await getPoolTradeQuote(pool, zeroForOne, input.native ? 10n ** 11n : 10n, 50, read)
      const outputAddress = output.native ? zeroAddress : output.address
      const before = await balance(outputAddress), hashes = new Set<Hex>()
      const hash = await executePoolTrade(quote, { ...context, onProgress: (p) => { if (p.hash) hashes.add(p.hash) } })
      const receipt = await read('eth_getTransactionReceipt', [hash]) as { status: string }
      expect(receipt.status).toBe('0x1')
      let gasPaid = 0n
      if (output.native) for (const submitted of hashes) {
        const mined = await read('eth_getTransactionReceipt', [submitted]) as { gasUsed: Hex; effectiveGasPrice: Hex }
        gasPaid += BigInt(mined.gasUsed) * BigInt(mined.effectiveGasPrice)
      }
      expect((await balance(outputAddress)) - before + gasPaid).toBeGreaterThanOrEqual(quote.minimumOut)
    }
  }, 30000)
  it('wraps then swaps WOKB as an ERC20 and receives WOKB as an ERC20 in reverse', async () => {
    const pool = (await listPools(read)).find((p) => p.protocol === 'v3')!
    const wrappedPool = { ...pool, currency0: { ...pool.currency0, native: false }, currency1: { ...pool.currency1, native: false } }
    await executeWrap({ direction: 'wrap', amount: 10n ** 12n }, context)
    for (const zeroForOne of [true, false]) {
      const [input, output] = poolTradeCurrencies({ pool: wrappedPool, zeroForOne })
      const amount = input.address.toLowerCase() === WOKB_ADDRESS.toLowerCase() ? 10n ** 11n : 10n
      const quote = await getPoolTradeQuote(wrappedPool, zeroForOne, amount, 50, read)
      const before = await balance(output.address)
      await executePoolTrade(quote, context)
      expect((await balance(output.address)) - before).toBeGreaterThanOrEqual(quote.minimumOut)
    }
  }, 30000)
  it('wraps and unwraps official WOKB 1:1 with successful receipts', async () => {
    const before = await balance(WOKB_ADDRESS), amount = 10n ** 10n
    const wrapped = await executeWrap({ direction: 'wrap', amount }, context)
    expect((await balance(WOKB_ADDRESS)) - before).toBe(amount)
    const unwrapped = await executeWrap({ direction: 'unwrap', amount }, context)
    expect(await balance(WOKB_ADDRESS)).toBe(before)
    for (const hash of [wrapped, unwrapped]) {
      const receipt = await read('eth_getTransactionReceipt', [hash]) as { status: string }
      expect(receipt.status).toBe('0x1')
    }
  }, 30000)
  it.each(['v3', 'v4'] as const)('%s routes through a newly initialized fee-500 pool', async (protocol) => {
    const draft = { protocol, currencyA: KNOWN_CURRENCIES[0], currencyB: KNOWN_CURRENCIES[2], fee: 500, tickSpacing: 10 }
    const empty = await discoverPool(draft, read)
    expect(empty.initialized).toBe(false)
    const mint = await prepareLiquidity({ kind: 'mint', pool: empty, initialPrice: '1', ...fullRange(10),
      amount0: empty.currency0.native ? 10n ** 14n : 100n, amount1: empty.currency1.native ? 10n ** 14n : 100n }, owner, read)
    await executeLiquidity(mint, { ...context, onProgress: () => {} })
    const pool = await discoverPool(draft, read)
    expect(pool.initialized).toBe(true)
    expect(pool.fee).toBe(500)
    const nativeIn = pool.currency0.native
    const quote = await getPoolTradeQuote(pool, nativeIn, 10n ** 13n, 50, read)
    const [, output] = poolTradeCurrencies(quote), before = await balance(output.address)
    const hash = await executePoolTrade(quote, context)
    const receipt = await read('eth_getTransactionReceipt', [hash]) as { status: string; logs: { address: string; topics: Hex[] }[] }
    expect(receipt.status).toBe('0x1')
    expect(receipt.logs.some((log) => protocol === 'v3'
      ? log.address.toLowerCase() === pool.address!.toLowerCase()
      : log.topics[1]?.toLowerCase() === pool.id.toLowerCase())).toBe(true)
    expect((await balance(output.address)) - before).toBeGreaterThanOrEqual(quote.minimumOut)
  }, 30000)
  it('V4 settles and pays arbitrary ERC20 inputs and outputs without native value', async () => {
    await executeWrap({ direction: 'wrap', amount: 10n ** 14n }, context)
    const draft = { protocol: 'v4' as const, currencyA: KNOWN_CURRENCIES[1], currencyB: KNOWN_CURRENCIES[2], fee: 500, tickSpacing: 10 }
    const empty = await discoverPool(draft, read)
    expect(empty.currency0.native || empty.currency1.native).toBe(false)
    const mint = await prepareLiquidity({ kind: 'mint', pool: empty, initialPrice: '1', ...fullRange(10), amount0: 100n, amount1: 10n ** 14n }, owner, read)
    await executeLiquidity(mint, { ...context, onProgress: () => {} })
    const pool = await discoverPool(draft, read)
    for (const zeroForOne of [true, false]) {
      const [input, output] = poolTradeCurrencies({ pool, zeroForOne })
      const quote = await getPoolTradeQuote(pool, zeroForOne, input.address.toLowerCase() === WOKB_ADDRESS.toLowerCase() ? 10n ** 13n : 10n, 50, read)
      const before = await balance(output.address)
      const hash = await executePoolTrade(quote, context)
      expect((await balance(output.address)) - before).toBeGreaterThanOrEqual(quote.minimumOut)
      const tx = await fixture.request('eth_getTransactionByHash', [hash]) as { value: Hex }
      expect(BigInt(tx.value)).toBe(0n)
    }
  }, 30000)
})
