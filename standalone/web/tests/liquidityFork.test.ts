import { startLiquidityFork } from './liquidityForkFixture'
import { encodeFunctionData, encodeAbiParameters, toHex, type Address, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  discoverPool,
  executeLiquidity,
  fullRange,
  getPosition,
  KNOWN_CURRENCIES,
  listPools,
  listPositions,
  LP_CONTRACTS,
  prepareLiquidity,
  type PublicRpc,
} from '../src/liquidity'
import { tokenAbi, v3ManagerAbi } from '../src/liquidity/abis'
import { poolKey } from '../src/liquidity/pools'
import { keyType } from '../src/liquidity/abis'
import { routerAbi } from '../src/trading/abis'
import { CONTRACTS } from '../src/trading/config'
import { call } from '../src/liquidity/rpc'
import { buildSwap } from '../src/trading/encoding'
import { transactionHash, waitReceipt } from '../src/trading/receipts'
const owner = '0x6ecf746b078d46391f8C425B150153212F7C0545' as Address
const fixturePath = process.env.SODADEX_LP_FORK_STATE
let fixture: Awaited<ReturnType<typeof startLiquidityFork>>
const newPositions = new Map<string, bigint>()
async function local(method: string, params: unknown[] = []): Promise<unknown> {
  return fixture.request(method, params)
}
const read: PublicRpc = (method, params) => local(method, params)
const provider = {
  request: ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> =>
    method === 'eth_accounts' ? Promise.resolve([owner]) : local(method, params),
}
const identity = { address: owner, provider, chainId: 196, revision: 1 }
const context = { identity, getIdentity: () => identity, onProgress: () => {}, read }
async function mineOperation(operation: Parameters<typeof prepareLiquidity>[0]): Promise<Hex> {
  const review = await prepareLiquidity(operation, owner, read)
  expect(review.maximum0).toBeLessThanOrEqual('amount0' in operation ? operation.amount0 : 0n)
  expect(review.maximum1).toBeLessThanOrEqual('amount1' in operation ? operation.amount1 : 0n)
  return executeLiquidity(review, context)
}
async function tokenBalance(): Promise<bigint> {
  return (await call(tokenAbi, KNOWN_CURRENCIES[2].address, 'balanceOf', [owner], read)) as bigint
}
describe.runIf(Boolean(fixturePath))('owned local chain-196 LP integration', () => {
  beforeAll(async () => {
    fixture = await startLiquidityFork({
      fixturePath: fixturePath!,
      stateViewCodePath: process.env.SODADEX_LP_STATEVIEW_CODE,
    })
  }, 20000)
  afterAll(() => fixture?.stop())
  it.each(['v3', 'v4'] as const)(
    '%s mints, increases, collects and fully withdraws with native refunds',
    async (protocol) => {
      const pool = (await listPools(read)).find((p) => p.protocol === protocol)!
      expect(pool.initialized).toBe(true)
      const before = await tokenBalance()
      expect(before).toBeGreaterThan(0n)
      const amounts = {
        amount0: pool.currency0.native ? 10n ** 14n : 100n,
        amount1: pool.currency1.native ? 10n ** 14n : 100n,
      }
      const manager = protocol === 'v3' ? LP_CONTRACTS.v3Manager : LP_CONTRACTS.v4Manager
      const mintHash = await mineOperation({ kind: 'mint', pool, ...fullRange(pool.tickSpacing), ...amounts })
      const receipt = (await local('eth_getTransactionReceipt', [mintHash])) as {
        logs: { address: string; topics: Hex[] }[]
      }
      const transfers = receipt.logs.filter(
        (l) => l.address.toLowerCase() === manager.toLowerCase() && l.topics.length === 4 && BigInt(l.topics[1]) === 0n,
      )
      expect(transfers).toHaveLength(1)
      const tokenId = BigInt(transfers[0].topics[3])
      let position = await getPosition(protocol, tokenId, read)
      expect(position.owner.toLowerCase()).toBe(owner.toLowerCase())
      const owned = await listPositions(owner, read)
      expect(owned.some((p) => p.protocol === protocol && p.tokenId === tokenId)).toBe(true)
      expect(position.liquidity).toBeGreaterThan(0n)
      const original = position.liquidity
      expect(before - (await tokenBalance())).toBeGreaterThan(0n)
      await mineOperation({ kind: 'increase', position, ...amounts })
      position = await getPosition(protocol, tokenId, read)
      expect(position.liquidity).toBeGreaterThan(original)
      const afterIncrease = await tokenBalance()
      if (protocol === 'v3') {
        // External clients can decrease without collecting; these stored assets include principal.
        const deadline =
          BigInt(((await local('eth_getBlockByNumber', ['latest', false])) as { timestamp: Hex }).timestamp) + 600n
        const data = encodeFunctionData({
          abi: v3ManagerAbi,
          functionName: 'decreaseLiquidity',
          args: [{ tokenId, liquidity: position.liquidity / 10n, amount0Min: 0n, amount1Min: 0n, deadline }],
        })
        const hash = transactionHash(
          await local('eth_sendTransaction', [{ from: owner, to: manager, data, gas: '0x1e8480' }]),
        )
        await waitReceipt(read, hash, owner, manager)
        const decreased = await getPosition(protocol, tokenId, read)
        expect(decreased.claimable0 + decreased.claimable1).toBeGreaterThan(0n)
        expect(decreased.fees0 + decreased.fees1).toBe(0n)
        const review = await prepareLiquidity({ kind: 'collect', position: decreased }, owner, read)
        expect(review.amount0).toBe(decreased.claimable0)
        expect(review.amount1).toBe(decreased.claimable1)
        position = decreased
      }

      const swap = buildSwap(
        { protocol, from: 'okb', to: 'usdt0', amount: 10n ** 12n, amountOut: 1n, minimumOut: 1n },
        owner,
        BigInt(((await local('eth_getBlockByNumber', ['latest', false])) as { timestamp: Hex }).timestamp) + 600n,
      )
      await local('eth_call', [swap, 'latest'])
      const swapHash = transactionHash(await local('eth_sendTransaction', [{ ...swap, gas: '0x1e8480' }]))
      await waitReceipt(read, swapHash, owner, swap.to)
      position = await getPosition(protocol, tokenId, read)
      if (protocol === 'v3') expect(position.fees0 + position.fees1).toBeGreaterThan(0n)
      await mineOperation({ kind: 'collect', position })
      position = await getPosition(protocol, tokenId, read)
      expect(position.fees0).toBe(0n)
      expect(position.fees1).toBe(0n)
      await mineOperation({ kind: 'decrease', position, liquidity: position.liquidity })
      position = await getPosition(protocol, tokenId, read)
      expect(position.liquidity).toBe(0n)
      expect(await tokenBalance()).toBeGreaterThan(afterIncrease)
      expect(await call(tokenAbi, KNOWN_CURRENCIES[1].address, 'balanceOf', [LP_CONTRACTS.v3Manager], read)).toBe(0n)
    },
    30000,
  )
  it.each(['v3', 'v4'] as const)(
    '%s creates and initializes a new permissionless pool with its first NFT',
    async (protocol) => {
      const pool = await discoverPool(
        { protocol, currencyA: KNOWN_CURRENCIES[0], currencyB: KNOWN_CURRENCIES[2], fee: 500, tickSpacing: 10 },
        read,
      )
      expect(pool.initialized).toBe(false)
      const mintHash = await mineOperation({
        kind: 'mint',
        pool,
        initialPrice: '1',
        ...fullRange(pool.tickSpacing),
        amount0: pool.currency0.native ? 10n ** 14n : 100n,
        amount1: pool.currency1.native ? 10n ** 14n : 100n,
      })
      const receipt = (await local('eth_getTransactionReceipt', [mintHash])) as {
        logs: { address: string; topics: Hex[] }[]
      }
      const manager = protocol === 'v3' ? LP_CONTRACTS.v3Manager : LP_CONTRACTS.v4Manager
      const minted = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === manager.toLowerCase() &&
          log.topics.length === 4 &&
          BigInt(log.topics[1]) === 0n,
      )!
      newPositions.set(protocol, BigInt(minted.topics[3]))
      const initialized = await discoverPool(
        { protocol, currencyA: KNOWN_CURRENCIES[0], currencyB: KNOWN_CURRENCIES[2], fee: 500, tickSpacing: 10 },
        read,
      )
      expect(initialized.initialized).toBe(true)
      expect(initialized.liquidity).toBeGreaterThan(0n)
      const listed = await listPools(read)
      expect(listed.some((p) => p.protocol === protocol && p.id.toLowerCase() === initialized.id.toLowerCase())).toBe(
        true,
      )
    },
    30000,
  )
  it('V4 increases a position when accrued fees exceed the additional native principal', async () => {
    const id = newPositions.get('v4')!
    let position = await getPosition('v4', id, read)
    const key = poolKey(position.pool),
      amount = 10n ** 13n
    const deadline =
      BigInt(((await local('eth_getBlockByNumber', ['latest', false])) as { timestamp: Hex }).timestamp) + 600n
    const single = encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { ...keyType, name: 'poolKey' },
            { name: 'zeroForOne', type: 'bool' },
            { name: 'amountIn', type: 'uint128' },
            { name: 'amountOutMinimum', type: 'uint128' },
            { name: 'minHopPriceX36', type: 'uint256' },
            { name: 'hookData', type: 'bytes' },
          ],
        },
      ],
      [{ poolKey: key, zeroForOne: true, amountIn: amount, amountOutMinimum: 1n, minHopPriceX36: 0n, hookData: '0x' }],
    )
    const unlock = encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes[]' }],
      [
        '0x060c0f',
        [
          single,
          encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [key.currency0, amount]),
          encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [key.currency1, 1n]),
        ],
      ],
    )
    const sweep = encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
      [key.currency0, owner, 0n],
    )
    const data = encodeFunctionData({
      abi: routerAbi,
      functionName: 'execute',
      args: ['0x1004', [unlock, sweep], deadline],
    })
    const hash = transactionHash(
      await local('eth_sendTransaction', [
        { from: owner, to: CONTRACTS.router, data, value: toHex(amount), gas: '0x1e8480' },
      ]),
    )
    await waitReceipt(read, hash, owner, CONTRACTS.router)
    position = await getPosition('v4', id, read)
    expect(position.fees0).toBeGreaterThan(10n ** 8n)
    const previous = position.liquidity
    await mineOperation({ kind: 'increase', position, amount0: 10n ** 8n, amount1: 1n })
    position = await getPosition('v4', id, read)
    expect(position.liquidity).toBeGreaterThan(previous)
    expect(position.claimable0 + position.claimable1).toBe(0n)
  }, 30000)
})
