import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { proxyRpc } from '../../worker/src/rpc'
import { zeroAddress, type Address, type Hex } from 'viem'
import { WOKB_ADDRESS } from '../src/domain/assets'
import { tokenAbi } from '../src/liquidity/abis'
import { KNOWN_CURRENCIES } from '../src/liquidity/config'
import { discoverPool, listPools } from '../src/liquidity/pools'
import { executeLiquidity } from '../src/liquidity/execution'
import { fullRange } from '../src/liquidity/math'
import { prepareLiquidity } from '../src/liquidity/preview'
import { call } from '../src/liquidity/rpc'
import { executePoolExactOutput, getPoolExactOutputQuote } from '../src/trading/poolExactOutput'
import { poolTradeCurrencies } from '../src/trading/poolTradeValidation'
import { executeWrap } from '../src/trading/wrapping'
import { CONTRACTS } from '../src/trading/config'
import type { PublicRpc, TradeIdentity } from '../src/trading/types'
import type { LiquidityPool } from '../src/liquidity/types'
import { startLiquidityFork } from './liquidityForkFixture'
const fixturePath = process.env.SODADEX_LP_FORK_STATE
const runtimePath = process.env.SODADEX_TRADE_RUNTIMES
const owner = '0x6ecf746b078d46391f8C425B150153212F7C0545' as Address
let fixture: Awaited<ReturnType<typeof startLiquidityFork>>
let snapshot: unknown
const evidence: Record<string, unknown>[] = []
const read: PublicRpc = (method, params) => fixture.request(method, params)
/** Runs the actual Worker registration/canonical gates, with upstream bound only to this owned Anvil. */
const gatedRead: PublicRpc = async (method, params = []) => {
  const response = await proxyRpc(new Request('https://soda.example/api/rpc', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }),
    (async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] }
      return Response.json({ jsonrpc: '2.0', id: body.id, result: await fixture.request(body.method, body.params) })
    }) as typeof fetch)
  const body = await response.json() as { result?: unknown; error?: unknown }
  if (body.error) throw Error(JSON.stringify(body.error))
  return body.result
}
const identity: TradeIdentity = { address: owner, chainId: 196, revision: 1,
  provider: { request: ({ method, params }) => method === 'eth_accounts' ? Promise.resolve([owner]) : fixture.request(method, params) } }
const context = { identity, getIdentity: () => identity, isCurrentForm: () => true, onProgress: () => {}, read }
const balance = async (asset: Address, account = owner): Promise<bigint> => asset === zeroAddress
  ? BigInt(await read('eth_getBalance', [account, 'latest']) as string)
  : await call(tokenAbi, asset, 'balanceOf', [account], read) as bigint
interface Receipt { status: Hex; gasUsed: Hex; effectiveGasPrice: Hex; l1Fee?: Hex }
const allGas = async (hashes: Iterable<Hex>): Promise<bigint> => {
  let result = 0n
  for (const hash of hashes) {
    const receipt = await read('eth_getTransactionReceipt', [hash]) as Receipt
    expect(receipt.status).toBe('0x1')
    result += BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) + BigInt(receipt.l1Fee ?? '0x0')
  }
  return result
}
async function prove(pool: LiquidityPool, zeroForOne: boolean): Promise<void> {
  const [input, output] = poolTradeCurrencies({ pool, zeroForOne })
  const out = output.native || output.address.toLowerCase() === WOKB_ADDRESS.toLowerCase() ? 10n ** 10n : 2n
  const quote = await getPoolExactOutputQuote(pool, zeroForOne, out, 50, gatedRead)
  const inputAsset = input.native ? zeroAddress : input.address, outputAsset = output.native ? zeroAddress : output.address
  const beforeInput = await balance(inputAsset), beforeOutput = await balance(outputAsset)
  const routerBefore = await Promise.all([zeroAddress, WOKB_ADDRESS, inputAsset, outputAsset].map((a) => balance(a, CONTRACTS.router)))
  const hashes = new Set<Hex>()
  const hash = await executePoolExactOutput(quote, { ...context, read: gatedRead, onProgress: (p) => { if (p.hash) hashes.add(p.hash) } })
  expect((await read('eth_getTransactionReceipt', [hash]) as Receipt).status).toBe('0x1')
  const gas = await allGas(hashes)
  const spent = beforeInput - await balance(inputAsset) - (input.native ? gas : 0n)
  const received = await balance(outputAsset) - beforeOutput + (output.native ? gas : 0n)
  expect(received).toBe(quote.amountOut)
  expect(spent).toBeGreaterThan(0n)
  expect(spent).toBeLessThanOrEqual(quote.maximumIn)
  expect(await Promise.all([zeroAddress, WOKB_ADDRESS, inputAsset, outputAsset].map((a) => balance(a, CONTRACTS.router)))).toEqual(routerBefore)
  const tx = await fixture.request('eth_getTransactionByHash', [hash]) as { value: Hex }
  expect(BigInt(tx.value)).toBe(input.native ? quote.maximumIn : 0n)
  evidence.push({ protocol: pool.protocol, poolId: pool.id, input: inputAsset, output: outputAsset,
    exactOutput: quote.amountOut.toString(), actualOutput: received.toString(), quotedInput: quote.amountIn.toString(),
    maximumInput: quote.maximumIn.toString(), actualInput: spent.toString(), refund: input.native ? (quote.maximumIn - spent).toString() : null,
    gasPaid: gas.toString(), hash, receipt: await read('eth_getTransactionReceipt', [hash]), workerGate: true, routerCustodyUnchanged: true })
  if (input.native) {
    expect(spent).toBeLessThan(quote.maximumIn)
    // The observed balance spends only actual input, despite attaching the full cap.
    expect(quote.maximumIn - spent).toBeGreaterThan(0n)
  }
}
describe.runIf(Boolean(fixturePath && runtimePath))('owned chain-196 exact-output Router execution', () => {
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
  afterAll(async () => {
    fixture?.stop()
    const folder = resolve(process.cwd(), '../../.analysis/exact-output')
    await mkdir(folder, { recursive: true })
    await writeFile(resolve(folder, 'receipts.json'), JSON.stringify({ mode: 'owned-anvil-only', chainId: 196, proofs: evidence }, null, 2) + '\n')
  })
  it.each(['v3', 'v4'] as const)('%s executes both native directions with exact receive, reviewed cap and full native refund', async (protocol) => {
    const pool = (await listPools(read)).find((p) => p.protocol === protocol)!
    await prove(pool, true)
    await prove(pool, false)
  }, 60000)
  it('V3 preserves ERC20 WOKB intent in both exact-output directions', async () => {
    await executeWrap({ direction: 'wrap', amount: 10n ** 13n }, context)
    const original = (await listPools(read)).find((p) => p.protocol === 'v3')!
    const pool = { ...original, currency0: { ...original.currency0, native: false }, currency1: { ...original.currency1, native: false } }
    await prove(pool, true)
    await prove(pool, false)
  }, 60000)
  it.each(['v3', 'v4'] as const)('%s accepts a newly registered ERC20 pair rather than a two-pool manifest allowlist', async (protocol) => {
    await executeWrap({ direction: 'wrap', amount: 2n * 10n ** 14n }, context)
    const draft = { protocol, currencyA: KNOWN_CURRENCIES[1], currencyB: KNOWN_CURRENCIES[2], fee: 500, tickSpacing: 10 }
    const empty = await discoverPool(draft, read)
    expect(empty.initialized).toBe(false)
    const mint = await prepareLiquidity({ kind: 'mint', pool: empty, initialPrice: '1', ...fullRange(10),
      amount0: 100n, amount1: 10n ** 14n }, owner, read)
    await executeLiquidity(mint, { ...context, onProgress: () => {} })
    const pool = await discoverPool(draft, read)
    expect(pool.initialized).toBe(true)
    await prove(pool, true)
    await prove(pool, false)
  }, 60000)
})
