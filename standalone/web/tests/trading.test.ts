import { decodeAbiParameters, decodeFunctionData, encodeFunctionResult, parseAbiParameters, type Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as policy from '../../trading-policy'
import { parseAmount } from '../src/domain/amount'
import { STABLE_ADDRESS, WOKB_ADDRESS } from '../src/domain/assets'
import { erc20Abi, permit2Abi, routerAbi, v3QuoterAbi, v4QuoterAbi } from '../src/trading/abis'
import { CONTRACTS, V4_POOL_ID, validatePools } from '../src/trading/config'
import { buildSwap, minimumOutput } from '../src/trading/encoding'
import { executeTrade } from '../src/trading/execution'
import { getQuote } from '../src/trading/quotes'
import { receiptStatus, waitReceipt } from '../src/trading/receipts'
import { TradeError, type PublicRpc, type Quote, type TradeIdentity, type TradeProgress } from '../src/trading/types'
const owner = '0x1111111111111111111111111111111111111111' as const
const other = '0x2222222222222222222222222222222222222222' as const
const hash = `0x${'a'.repeat(64)}` as Hex
beforeEach(() => {
  vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(true)
})
const base: Quote = {
  from: 'okb',
  to: 'usdt0',
  amount: 10n ** 18n,
  amountOut: 1000001n,
  minimumOut: 995001n,
  protocol: 'v4',
}
function fixture() {
  let tokenAllowance = 0n,
    permitAmount = 0n,
    expiration = 0
  const submitted: { to: string; data: Hex; value: Hex }[] = []
  const events: TradeProgress[] = []
  const provider = {
    request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === 'eth_accounts') return [owner]
      if (method === 'eth_chainId') return '0xc4'
      if (method === 'eth_sendTransaction') {
        const tx = params?.[0] as (typeof submitted)[number]
        submitted.push(tx)
        if (tx.to === STABLE_ADDRESS) {
          const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data })
          if (decoded.functionName === 'approve') tokenAllowance = decoded.args[1]
        }
        if (tx.to === CONTRACTS.permit2) {
          const args = decodeFunctionData({ abi: permit2Abi, data: tx.data }).args
          permitAmount = BigInt(args[2])
          expiration = Number(args[3])
        }
        return hash
      }
      throw Error(method)
    }),
  }
  const identity: TradeIdentity = { provider, address: owner, chainId: 196, revision: 1 }
  const read: PublicRpc = vi.fn(async (method, params) => {
    if (method === 'eth_chainId') return '0xc4'
    if (method === 'eth_getBlockByNumber') return { timestamp: '0x3e8' }
    if (method === 'eth_getBalance') return '0x1000000000000000000000'
    if (method === 'eth_gasPrice') return '0x1'
    if (method === 'eth_estimateGas') return '0x186a0'
    if (method === 'eth_call') {
      const tx = params?.[0] as { to: string; data: Hex }
      if (tx.to === CONTRACTS.v3Quoter)
        return encodeFunctionResult({
          abi: v3QuoterAbi,
          functionName: 'quoteExactInputSingle',
          result: [1000000n, 0n, 0, 0n],
        })
      if (tx.to === CONTRACTS.v4Quoter)
        return encodeFunctionResult({
          abi: v4QuoterAbi,
          functionName: 'quoteExactInputSingle',
          result: [base.amountOut, 0n],
        })
      if (tx.to === STABLE_ADDRESS && tx.data.startsWith('0xdd62ed3e'))
        return encodeFunctionResult({ abi: erc20Abi, functionName: 'allowance', result: tokenAllowance })
      if (tx.to === CONTRACTS.permit2 && tx.data.startsWith('0x927da105'))
        return encodeFunctionResult({
          abi: permit2Abi,
          functionName: 'allowance',
          result: [permitAmount, expiration, 0],
        })
      return '0x'
    }
    throw Error(method)
  })
  return {
    identity,
    read,
    submitted,
    events,
    wait: vi.fn(async () => {}),
    setToken: (a: bigint) => {
      tokenAllowance = a
    },
  }
}
describe('exact test-pool trading', () => {
  it.each(['v3', 'v4'] as const)('rejects paused %s trades in both directions before any RPC or wallet request', async (protocol) => {
    vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(false)
    for (const nativeIn of [true, false]) {
      const f = fixture()
      const review: Quote = { ...base, protocol, from: nativeIn ? 'okb' : 'usdt0', to: nativeIn ? 'usdt0' : 'okb' }
      await expect(executeTrade(review, {
        identity: f.identity, getIdentity: () => f.identity, isCurrentForm: () => true,
        onProgress: (p) => f.events.push(p), read: f.read, wait: f.wait, ready: true,
      })).rejects.toThrow('tradePaused')
      await expect(getQuote(review, protocol, f.read, true)).rejects.toThrow('tradePaused')
      expect(f.read).not.toHaveBeenCalled()
      expect(f.identity.provider.request).not.toHaveBeenCalled()
    }
  })
  it('retains a submitted approval hash and stops subsequent writes when trading pauses during confirmation', async () => {
    const f = fixture()
    f.wait.mockImplementationOnce(async () => { vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(false) })
    await expect(executeTrade({ ...base, from: 'usdt0', to: 'okb' }, {
      identity: f.identity, getIdentity: () => f.identity, isCurrentForm: () => true,
      onProgress: (p) => f.events.push(p), read: f.read, wait: f.wait, ready: true,
    })).rejects.toThrow('tradePaused')
    expect(f.submitted).toHaveLength(1)
    expect(f.events.at(-1)).toMatchObject({ hash, kind: 'approval' })
  })
  it('keeps six decimal input and rounds minimum upwards so a micro-unit cannot breach 0.5%', () => {
    expect(parseAmount('1.000001', 6)).toEqual({ kind: 'valid', units: 1000001n })
    expect(parseAmount('1.0000001', 6).kind).toBe('invalid')
    expect(minimumOutput(1000001n)).toBe(995001n)
    expect(minimumOutput(1n)).toBe(1n)
    expect(() => minimumOutput(0n)).toThrow('tradeUnavailable')
  })
  it('fails closed for missing/pending/mismatched pool records', () => {
    expect(validatePools(undefined).ready).toBe(false)
    expect(validatePools({ status: 'ready', chainId: 1 }).ready).toBe(false)
    const manifest = {
      schemaVersion: 1,
      chainId: 196,
      status: 'ready',
      slippageBps: 50,
      deadlineSeconds: 600,
      stable: { address: STABLE_ADDRESS, decimals: 6 },
      v3: { address: other, token0: STABLE_ADDRESS, token1: WOKB_ADDRESS, fee: 100, tickSpacing: 1 },
      v4: {
        poolId: V4_POOL_ID,
        currency0: zeroAddress,
        currency1: STABLE_ADDRESS,
        fee: 0,
        tickSpacing: 1,
        hooks: zeroAddress,
      },
    }
    expect(validatePools(manifest)).toEqual({ ready: true, v3Address: other })
    expect(validatePools({ ...manifest, status: 'pending' }).ready).toBe(false)
    expect(validatePools({ ...manifest, v4: { ...manifest.v4, fee: 100 } }).ready).toBe(false)
    expect(V4_POOL_ID).toBe('0x326670fbdc54a57ec96182faebc60ce6f06e9073e0044e978805520be3c6983e')
  })
  it('encodes pinned six-field V3 swaps, recipient and native refunds in both directions', () => {
    for (const nativeIn of [true, false]) {
      const quote: Quote = { ...base, protocol: 'v3', from: nativeIn ? 'okb' : 'usdt0', to: nativeIn ? 'usdt0' : 'okb' }
      const tx = buildSwap(quote, owner, 1600n)
      const decoded = decodeFunctionData({ abi: routerAbi, data: tx.data }).args
      expect(decoded[0]).toBe(nativeIn ? '0x0b000c04' : '0x000c04')
      const swap = decodeAbiParameters(
        parseAbiParameters('address,uint256,uint256,bytes,bool,uint256[]'),
        decoded[1][nativeIn ? 1 : 0],
      )
      expect(swap[0].toLowerCase()).toBe(nativeIn ? owner : '0x0000000000000000000000000000000000000002')
      expect(swap[1]).toBe(quote.amount)
      expect(swap[2]).toBe(quote.minimumOut)
      expect(swap[4]).toBe(!nativeIn)
      expect(swap[5]).toEqual([])
      expect(decoded[1].at(-1)).toBe(encodeSweep(owner))
      expect(decoded[2]).toBe(1600n)
      expect(BigInt(tx.value)).toBe(nativeIn ? quote.amount : 0n)
    }
  })
  it('encodes V4 native swap, settle max and take min with refund to the owner', () => {
    const tx = buildSwap(base, owner, 1600n)
    const [commands, inputs] = decodeFunctionData({ abi: routerAbi, data: tx.data }).args
    expect(commands).toBe('0x1004')
    const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), inputs[0])
    expect(actions).toBe('0x060c0f')
    expect(decodeAbiParameters(parseAbiParameters('address,uint256'), params[1])[1]).toBe(base.amount)
    expect(decodeAbiParameters(parseAbiParameters('address,uint256'), params[2])).toEqual([
      STABLE_ADDRESS,
      base.minimumOut,
    ])
    expect(inputs[1]).toBe(encodeSweep(owner))
  })
  it('compares real route outputs, rejects unsupported pair and never quotes pending pools', async () => {
    const f = fixture()
    const quote = await getQuote(base, 'auto', f.read, true)
    expect(quote.protocol).toBe('v4')
    expect(quote.amountOut).toBe(1000001n)
    await expect(getQuote(base, 'v4', f.read, false)).rejects.toThrow('tradeNotReady')
    await expect(getQuote({ ...base, to: 'wokb' }, 'auto', f.read, true)).rejects.toThrow('tradeUnsupported')
  })
  it('resets a nonzero insufficient allowance, grants exact amount and waits/re-reads each approval', async () => {
    const f = fixture()
    f.setToken(5n)
    const review = { ...base, from: 'usdt0' as const, to: 'okb' as const, amount: 1000001n }
    await executeTrade(review, {
      identity: f.identity,
      getIdentity: () => f.identity,
      isCurrentForm: () => true,
      onProgress: (p) => f.events.push(p),
      read: f.read,
      wait: f.wait,
      ready: true,
    })
    expect(f.submitted).toHaveLength(4)
    expect(decodeFunctionData({ abi: erc20Abi, data: f.submitted[0].data }).args).toEqual([CONTRACTS.permit2, 0n])
    expect(decodeFunctionData({ abi: erc20Abi, data: f.submitted[1].data }).args).toEqual([CONTRACTS.permit2, 1000001n])
    expect(decodeFunctionData({ abi: permit2Abi, data: f.submitted[2].data }).args).toEqual([
      STABLE_ADDRESS,
      CONTRACTS.router,
      1000001n,
      1600,
    ])
    expect(f.wait).toHaveBeenCalledTimes(4)
    expect(f.events.at(-1)?.stage).toBe('tradeSucceeded')
  })
  it('stops subsequent writes when the user rejects the Permit2 approval after a confirmed token approval', async () => {
    const f = fixture(),
      original = f.identity.provider.request
    f.identity.provider.request = async (args) => {
      const tx = args.params?.[0] as { to?: string } | undefined
      if (args.method === 'eth_sendTransaction' && tx?.to === CONTRACTS.permit2) throw { code: 4001 }
      return original(args)
    }
    await expect(
      executeTrade(
        { ...base, from: 'usdt0', to: 'okb' },
        {
          identity: f.identity,
          getIdentity: () => f.identity,
          isCurrentForm: () => true,
          onProgress: () => {},
          read: f.read,
          wait: f.wait,
          ready: true,
        },
      ),
    ).rejects.toMatchObject({ code: 4001 })
    expect(f.submitted).toHaveLength(1)
    expect(f.submitted[0].to).toBe(STABLE_ADDRESS)
    expect(f.wait).toHaveBeenCalledTimes(1)
  })
  it('stops before a wallet request when OKB cannot cover the input and estimated gas', async () => {
    const f = fixture()
    const read: PublicRpc = async (method, params) => (method === 'eth_getBalance' ? '0x0' : f.read(method, params))
    await expect(
      executeTrade(base, {
        identity: f.identity,
        getIdentity: () => f.identity,
        isCurrentForm: () => true,
        onProgress: () => {},
        read,
        wait: f.wait,
        ready: true,
      }),
    ).rejects.toThrow('tradeGasBalance')
    expect(f.submitted).toHaveLength(0)
  })
  it('does not overwrite the reviewed minimum after a worse refreshed quote', async () => {
    const f = fixture()
    await expect(
      executeTrade(
        { ...base, amountOut: 2000000n, minimumOut: 1990000n },
        {
          identity: f.identity,
          getIdentity: () => f.identity,
          isCurrentForm: () => true,
          onProgress: () => {},
          read: f.read,
          wait: f.wait,
          ready: true,
        },
      ),
    ).rejects.toThrow('tradeQuoteChanged')
    expect(f.submitted).toHaveLength(0)
  })
  it('stops before sending if account revision changes during an awaited quote', async () => {
    const f = fixture()
    let current = f.identity
    const read: PublicRpc = async (method, params) => {
      const result = await f.read(method, params)
      if (method === 'eth_call') current = { ...f.identity, address: other, revision: 2 }
      return result
    }
    await expect(
      executeTrade(base, {
        identity: f.identity,
        getIdentity: () => current,
        isCurrentForm: () => true,
        onProgress: () => {},
        read,
        wait: f.wait,
        ready: true,
      }),
    ).rejects.toThrow('tradeIdentityChanged')
    expect(f.submitted).toHaveLength(0)
  })
  it('retains a submitted approval hash then stops subsequent writes when the account changes inside the wallet prompt', async () => {
    const f = fixture()
    let current = f.identity
    const original = f.identity.provider.request
    f.identity.provider.request = async (args) => {
      const result = await original(args)
      if (args.method === 'eth_sendTransaction') current = { ...f.identity, revision: 2 }
      return result
    }
    await expect(
      executeTrade(
        { ...base, from: 'usdt0', to: 'okb' },
        {
          identity: f.identity,
          getIdentity: () => current,
          isCurrentForm: () => true,
          onProgress: (p) => f.events.push(p),
          read: f.read,
          wait: f.wait,
          ready: true,
        },
      ),
    ).rejects.toThrow('tradeIdentityChanged')
    expect(f.submitted).toHaveLength(1)
    expect(f.events.at(-1)?.hash).toBe(hash)
  })
  it('never re-sends a submitted transaction on a pending receipt timeout', async () => {
    const f = fixture()
    await expect(
      executeTrade(base, {
        identity: f.identity,
        getIdentity: () => f.identity,
        isCurrentForm: () => true,
        onProgress: (p) => f.events.push(p),
        read: f.read,
        wait: async () => {
          throw new TradeError('tradePending')
        },
        ready: true,
      }),
    ).rejects.toThrow('tradePending')
    expect(f.submitted).toHaveLength(1)
    expect(f.events.at(-1)).toMatchObject({ hash, kind: 'swap' })
  })
})
import { encodeAbiParameters, zeroAddress, type Address } from 'viem'
function encodeSweep(address: Address): Hex {
  return encodeAbiParameters(parseAbiParameters('address,address,uint256'), [zeroAddress, address, 0n])
}
describe('receipt confirmation', () => {
  it('distinguishes null pending, mined revert and successful receipt for the expected transaction', async () => {
    const receipt = { transactionHash: hash, from: owner, to: CONTRACTS.router, blockHash: hash, status: '0x1' }
    await expect(receiptStatus(async () => null, hash, owner, CONTRACTS.router)).resolves.toBe('pending')
    await expect(receiptStatus(async () => receipt, hash, owner, CONTRACTS.router)).resolves.toBe('success')
    await expect(
      receiptStatus(async () => ({ ...receipt, status: '0x0' }), hash, owner, CONTRACTS.router),
    ).rejects.toThrow('tradeReverted')
    await expect(
      receiptStatus(async () => ({ ...receipt, from: other }), hash, owner, CONTRACTS.router),
    ).rejects.toThrow('tradeFailed')
  })
  it('polls bounded reads and returns pending without broadcasting', async () => {
    const read = vi.fn(async () => null),
      sleep = vi.fn(async () => {})
    await expect(waitReceipt(read, hash, owner, CONTRACTS.router, sleep, 2)).rejects.toThrow('tradePending')
    expect(read).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })
})
