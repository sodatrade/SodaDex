import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeFunctionResult,
  encodeAbiParameters,
  encodeEventTopics,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { feeDelta, initializePrice, positionForLiquidity, positionFromAmounts } from '../src/liquidity/math'
import {
  defaultLpSlippageBps,
  listPools,
  executeLiquidity,
  fullRange,
  KNOWN_CURRENCIES,
  liquidityForBps,
  LP_CONTRACTS,
  NATIVE_CURRENCY,
  prepareLiquidity,
  type LiquidityPool,
  type LiquidityPreview,
  type PublicRpc,
} from '../src/liquidity'
import { buildLiquidityTransaction } from '../src/liquidity/encoding'
import { factoryAbi, poolAbi, permitAbi, stateAbi, tokenAbi, v3ManagerAbi, v4ManagerAbi } from '../src/liquidity/abis'
import { createdAbi } from '../src/liquidity/events'
const owner = '0x1111111111111111111111111111111111111111' as const
const stable = KNOWN_CURRENCIES[2]
const hash = `0x${'a'.repeat(64)}` as Hex
function base(protocol: 'v3' | 'v4' = 'v4'): LiquidityPool {
  const currency0 = protocol === 'v4' ? NATIVE_CURRENCY : stable,
    currency1 = protocol === 'v4' ? stable : { ...NATIVE_CURRENCY, address: KNOWN_CURRENCIES[1].address }
  return initializePrice(
    {
      protocol,
      id: protocol === 'v4' ? `0x${'1'.repeat(64)}` : owner,
      address: protocol === 'v3' ? owner : undefined,
      currency0,
      currency1,
      fee: protocol === 'v3' ? 100 : 0,
      tickSpacing: 1,
      sqrtPriceX96: 0n,
      tick: 0,
      liquidity: 0n,
      initialized: false,
    },
    '1',
  )
}
function preview(protocol: 'v3' | 'v4' = 'v4'): LiquidityPreview {
  const pool = base(protocol)
  const range = fullRange(1)
  const data = {
    operation: { kind: 'mint' as const, pool, amount0: 1000000n, amount1: 1000000n, ...range },
    owner,
    pool,
    slippageBps: defaultLpSlippageBps(pool),
    deadline: 1600n,
    liquidity: 1000n,
    amount0: 100n,
    amount1: 100n,
    minimum0: 99n,
    minimum1: 99n,
    maximum0: 101n,
    maximum1: 101n,
  }
  return { ...data, approvals: [], transaction: buildLiquidityTransaction(data) }
}
function executionFixture(p: LiquidityPreview) {
  let allowed = 0n,
    permitAmount = 0n,
    expiry = 0,
    revision = 1
  const sent: { to: Address; data: Hex; value: Hex }[] = []
  const provider = {
    request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === 'eth_accounts') return [owner]
      if (method === 'eth_chainId') return '0xc4'
      if (method === 'eth_sendTransaction') {
        const tx = params![0] as (typeof sent)[number]
        sent.push(tx)
        if (tx.to === stable.address) allowed = decodeFunctionData({ abi: tokenAbi, data: tx.data }).args![1] as bigint
        if (tx.to === LP_CONTRACTS.permit2) {
          const a = decodeFunctionData({ abi: permitAbi, data: tx.data }).args!
          permitAmount = a[2] as bigint
          expiry = Number(a[3])
        }
        return hash
      }
      throw Error(method)
    }),
  }
  const identity = { provider, address: owner, chainId: 196, revision }
  const read: PublicRpc = vi.fn(async (method, params) => {
    if (method === 'eth_chainId') return '0xc4'
    if (method === 'eth_blockNumber') return '0x1'
    if (method === 'eth_getBlockByNumber') return { timestamp: '0x3e8' }
    if (method === 'eth_getBalance') return '0x100000000000000000000'
    if (method === 'eth_gasPrice') return '0x1'
    if (method === 'eth_estimateGas') return '0x10000'
    if (method === 'eth_call') {
      const tx = params![0] as { to: Address; data: Hex }
      if (tx.to === stable.address && tx.data.startsWith('0xdd62ed3e'))
        return encodeFunctionResult({ abi: tokenAbi, functionName: 'allowance', result: allowed })
      if (tx.to === LP_CONTRACTS.permit2 && tx.data.startsWith('0x927da105'))
        return encodeFunctionResult({ abi: permitAbi, functionName: 'allowance', result: [permitAmount, expiry, 0] })
      return '0x'
    }
    throw Error(method)
  })
  return {
    identity,
    getIdentity: () => ({ ...identity, revision }),
    read,
    wait: vi.fn(async () => {}),
    onProgress: vi.fn(),
    sent,
    change: () => revision++,
    setAllowance: (n: bigint) => (allowed = n),
    preview: p,
  }
}
describe('LP domain boundaries', () => {
  it('keeps readable pools when a permissionless pool references an EOA, but propagates log failures', async () => {
    const p3 = base('v3'),
      p4 = base('v4'),
      extra = '0x2222222222222222222222222222222222222222' as Address,
      invalid = '0x3333333333333333333333333333333333333333' as Address
    const event = (token0: Address, fee: number, address: Address) => ({
      address: LP_CONTRACTS.factory,
      topics: encodeEventTopics({
        abi: createdAbi,
        eventName: 'PoolCreated',
        args: { token0, token1: KNOWN_CURRENCIES[1].address, fee },
      }),
      data: encodeAbiParameters([{ type: 'int24' }, { type: 'address' }], [10, address]),
      blockNumber: '0x45f668d',
      logIndex: fee === 500 ? '0x1' : '0x0',
    })
    const read: PublicRpc = vi.fn(async (method, params) => {
      if (method === 'eth_blockNumber') return '0x45f668d'
      if (method === 'eth_getCode') return '0x'
      if (method === 'eth_getLogs')
        return (params![0] as { address: Address }).address === LP_CONTRACTS.factory
          ? [event(invalid, 100, invalid), event(stable.address, 500, extra)]
          : []
      if (method === 'eth_call') {
        const tx = params![0] as { to: Address; data: Hex }
        if (tx.to === LP_CONTRACTS.factory) {
          const d = decodeFunctionData({ abi: factoryAbi, data: tx.data })
          return d.functionName === 'feeAmountTickSpacing'
            ? encodeFunctionResult({
                abi: factoryAbi,
                functionName: 'feeAmountTickSpacing',
                result: d.args[0] === 500 ? 10 : 1,
              })
            : encodeFunctionResult({
                abi: factoryAbi,
                functionName: 'getPool',
                result: d.args[2] === 500 ? extra : owner,
              })
        }
        if (tx.to === LP_CONTRACTS.stateView) {
          const d = decodeFunctionData({ abi: stateAbi, data: tx.data })
          return d.functionName === 'getSlot0'
            ? encodeFunctionResult({
                abi: stateAbi,
                functionName: 'getSlot0',
                result: [p4.sqrtPriceX96, p4.tick, 0, 0],
              })
            : encodeFunctionResult({ abi: stateAbi, functionName: 'getLiquidity', result: 0n })
        }
        const d = decodeFunctionData({ abi: poolAbi, data: tx.data })
        return d.functionName === 'slot0'
          ? encodeFunctionResult({
              abi: poolAbi,
              functionName: 'slot0',
              result: [p3.sqrtPriceX96, p3.tick, 0, 0, 0, 0, true],
            })
          : encodeFunctionResult({ abi: poolAbi, functionName: 'liquidity', result: 0n })
      }
      throw Error(method)
    })
    const pools = await listPools(read)
    expect(pools).toHaveLength(3)
    expect(pools.some((p) => p.id === extra)).toBe(true)
    const failing: PublicRpc = async (method, params) => {
      if (method === 'eth_getLogs') throw Error('upstream logs unavailable')
      return read(method, params)
    }
    await expect(listPools(failing)).rejects.toThrow('upstream logs unavailable')
  })
  it('closes both V4 increase currencies so net fee credits can be paid out', () => {
    const p = preview()
    p.operation = {
      kind: 'increase',
      position: {
        protocol: 'v4',
        tokenId: 1n,
        owner,
        pool: p.pool,
        ...fullRange(1),
        liquidity: 100n,
        amount0: 1n,
        amount1: 1n,
        fees0: 200n,
        fees1: 0n,
        claimable0: 200n,
        claimable1: 0n,
        inRange: true,
      },
      amount0: p.maximum0,
      amount1: p.maximum1,
    }
    const tx = buildLiquidityTransaction(p)
    const decoded = decodeFunctionData({ abi: v4ManagerAbi, data: tx.data })
    const [actions, parameters] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], decoded.args![0] as Hex)
    expect(actions).toBe('0x00121214')
    expect(parameters).toHaveLength(4)
    expect(decodeAbiParameters([{ type: 'address' }], parameters[1])).toEqual([p.pool.currency0.address])
    expect(decodeAbiParameters([{ type: 'address' }], parameters[2])).toEqual([p.pool.currency1.address])
  })
  it('stops a new-pool review when another wallet initialized it during approvals', async () => {
    const p = preview()
    p.operation = {
      kind: 'mint',
      pool: { ...p.pool, initialized: false, sqrtPriceX96: 0n },
      ...fullRange(1),
      amount0: p.maximum0,
      amount1: p.maximum1,
      initialPrice: '1',
    }
    p.transaction = buildLiquidityTransaction(p)
    const f = executionFixture(p),
      original = vi.mocked(f.read).getMockImplementation()!
    vi.mocked(f.read).mockImplementation(async (method, params) => {
      const tx = params?.[0] as { to?: Address; data?: Hex } | undefined
      if (method === 'eth_call' && tx?.to === LP_CONTRACTS.stateView) {
        const name = decodeFunctionData({ abi: stateAbi, data: tx.data! }).functionName
        return name === 'getSlot0'
          ? encodeFunctionResult({
              abi: stateAbi,
              functionName: 'getSlot0',
              result: [p.pool.sqrtPriceX96, p.pool.tick, 0, 0],
            })
          : encodeFunctionResult({ abi: stateAbi, functionName: 'getLiquidity', result: 0n })
      }
      return original(method, params)
    })
    await expect(executeLiquidity(p, f)).rejects.toMatchObject({ code: 'poolChanged' })
    expect(f.sent.every((tx) => tx.to !== LP_CONTRACTS.v4Manager)).toBe(true)
  })

  it('rejects expired reviews before asking the wallet to authorize or send', async () => {
    const p = preview()
    p.deadline = 999n
    p.transaction = buildLiquidityTransaction(p)
    const f = executionFixture(p)
    await expect(executeLiquidity(p, f)).rejects.toMatchObject({ code: 'expired' })
    expect(f.sent).toHaveLength(0)
  })
  it('refuses a stale form before any asynchronous RPC or wallet action', async () => {
    const p = preview(),
      f = executionFixture(p)
    await expect(executeLiquidity(p, { ...f, isCurrentForm: () => false })).rejects.toMatchObject({
      code: 'identityChanged',
    })
    expect(f.read).not.toHaveBeenCalled()
    expect(f.sent).toHaveLength(0)
  })

  it('uses the upstream LP defaults without inheriting swap slippage', () => {
    expect(defaultLpSlippageBps(base('v3'))).toBe(250)
    expect(defaultLpSlippageBps(base('v4'))).toBe(5)
    expect(defaultLpSlippageBps({ ...base('v4'), currency0: KNOWN_CURRENCIES[1] })).toBe(250)
  })
  it('aligns full range and rejects invalid percentage/range inputs', () => {
    expect(fullRange(60)).toEqual({ tickLower: -887220, tickUpper: 887220 })
    expect(liquidityForBps(101n, 5000)).toBe(50n)
    expect(liquidityForBps(101n, 10000)).toBe(101n)
    expect(() => liquidityForBps(101n, -1)).toThrow()
    expect(() => positionFromAmounts({ ...base(), tickSpacing: 60 }, -1, 60, 1n, 1n)).toThrow()
  })
  it.each(['v3', 'v4'] as const)(
    'computes exact %s full range and one-sided positions above/below range',
    (protocol) => {
      const pool = base(protocol),
        range = fullRange(1)
      const p = positionFromAmounts(pool, range.tickLower, range.tickUpper, 10n ** 18n, 10n ** 18n)
      expect(BigInt(p.mintAmounts.amount0.toString())).toBeLessThanOrEqual(10n ** 18n)
      expect(BigInt(p.mintAmounts.amount1.toString())).toBeLessThanOrEqual(10n ** 18n)
      const lower = pool.tick + 100,
        upper = pool.tick + 200
      const out = positionForLiquidity(pool, lower, upper, 10n ** 18n)
      expect(BigInt(out.amount1.quotient.toString())).toBe(0n)
      expect(BigInt(out.amount0.quotient.toString())).toBeGreaterThan(0n)
    },
  )
  it('handles uint256 fee growth wraparound without floating point', () =>
    expect(feeDelta(2n, (1n << 256n) - 2n, 1n << 128n)).toBe(4n))
  it('encodes V4 explicit liquidity, spending caps, payer settlement and current owner sweep', () => {
    const p = preview(),
      decoded = decodeFunctionData({ abi: v4ManagerAbi, data: p.transaction.data })
    expect(decoded.functionName).toBe('modifyLiquidities')
    const [actions, parameters] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], decoded.args![0] as Hex)
    expect(actions).toBe('0x020d14')
    expect(parameters).toHaveLength(3)
    expect(decodeAbiParameters([{ type: 'address' }, { type: 'address' }], parameters[2])).toEqual([zeroAddress, owner])
    expect(BigInt(p.transaction.value)).toBe(p.maximum0)
  })
  it('encodes V3 native funding with refundETH', () => {
    const p = preview('v3'),
      decoded = decodeFunctionData({ abi: v3ManagerAbi, data: p.transaction.data })
    const calls = decoded.args![0] as Hex[]
    expect(decodeFunctionData({ abi: v3ManagerAbi, data: calls.at(-1)! }).functionName).toBe('refundETH')
    expect(BigInt(p.transaction.value)).toBe(p.maximum1)
  })
  it('uses finite exact approvals and Permit2 expiry then submits only after simulations', async () => {
    const p = preview(),
      f = executionFixture(p)
    f.setAllowance(1n)
    await executeLiquidity(p, f)
    expect(f.sent).toHaveLength(4)
    expect(decodeFunctionData({ abi: tokenAbi, data: f.sent[0].data }).args).toEqual([LP_CONTRACTS.permit2, 0n])
    expect(decodeFunctionData({ abi: tokenAbi, data: f.sent[1].data }).args).toEqual([LP_CONTRACTS.permit2, p.maximum1])
    expect(decodeFunctionData({ abi: permitAbi, data: f.sent[2].data }).args).toEqual([
      stable.address,
      LP_CONTRACTS.v4Manager,
      p.maximum1,
      Number(p.deadline),
    ])
    expect(f.onProgress).toHaveBeenLastCalledWith({
      stage: 'success',
      hash,
      kind: 'liquidity',
      to: LP_CONTRACTS.v4Manager,
    })
  })
  it('stops after a wallet identity revision changes during an approval', async () => {
    const p = preview(),
      f = executionFixture(p)
    f.wait.mockImplementation(async () => {
      f.change()
    })
    await expect(executeLiquidity(p, f)).rejects.toMatchObject({ code: 'identityChanged' })
    expect(f.sent).toHaveLength(1)
    expect(f.onProgress).toHaveBeenLastCalledWith({ stage: 'pending', hash, kind: 'approval', to: stable.address })
  })
  it('rejects expired review and modified calldata before wallet writes', async () => {
    const p = preview(),
      f = executionFixture(p)
    p.transaction.data = '0x'
    await expect(executeLiquidity(p, f)).rejects.toMatchObject({ code: 'failed' })
    expect(f.sent).toHaveLength(0)
  })
  it('previews against live state and uses guarded amounts that stay within the input caps', async () => {
    const p = base(),
      read: PublicRpc = async (method, params) => {
        if (method === 'eth_chainId') return '0xc4'
        if (method === 'eth_getBlockByNumber') return { timestamp: '0x3e8' }
        const tx = params![0] as { to: Address; data: Hex }
        const decoded = decodeFunctionData({ abi: stateAbi, data: tx.data })
        if (decoded.functionName === 'getSlot0')
          return encodeFunctionResult({
            abi: stateAbi,
            functionName: 'getSlot0',
            result: [p.sqrtPriceX96, p.tick, 0, 0],
          })
        return encodeFunctionResult({ abi: stateAbi, functionName: 'getLiquidity', result: 0n })
      }
    const review = await prepareLiquidity(
      { kind: 'mint', pool: p, ...fullRange(1), amount0: 10n ** 15n, amount1: 1000n },
      owner,
      read,
    )
    expect(review.maximum0).toBeLessThanOrEqual(10n ** 15n)
    expect(review.maximum1).toBeLessThanOrEqual(1000n)
    expect(review.liquidity).toBeGreaterThan(0n)
    expect(review.deadline).toBe(1600n)
  })
})
