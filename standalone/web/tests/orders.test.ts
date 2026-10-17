import { decodeFunctionData, encodeFunctionResult, hashTypedData, verifyTypedData, zeroAddress, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'
import { orderTypedData, type SodaLimitOrder } from '../../order-types'
import { STABLE_ADDRESS, WOKB_ADDRESS } from '../src/domain/assets'
import { decodeOrder } from '../src/features/orders/api'
import { orderDeployment, type OrderDeployment } from '../src/features/orders/config'
import { draftOrder } from '../src/features/orders/model'
import { cancelLimitOrder, orderReadAbi, signLimitOrder } from '../src/features/orders/signing'
import { KNOWN_CURRENCIES } from '../src/liquidity'
import type { LiquidityPool } from '../src/liquidity/types'
import { erc20Abi } from '../src/trading/abis'
import { CONTRACTS } from '../src/trading/config'
import type { PublicRpc, TradeIdentity, Transaction } from '../src/trading/types'
const settlement = '0x1111111111111111111111111111111111111111'
const deployment: OrderDeployment = { chainId: 196, settlement, deploymentBlock: 1, apiOrigin: 'http://127.0.0.1:8792', executionEnabled: true }
const base = { schemaVersion: 1, stage: 'test', status: 'ready', ...deployment }
const from = KNOWN_CURRENCIES.find(c => !c.native && c.address === WOKB_ADDRESS)!
const to = KNOWN_CURRENCIES.find(c => c.address === STABLE_ADDRESS)!
const pool: LiquidityPool = { protocol: 'v3', id: '0x3333333333333333333333333333333333333333', currency0: to, currency1: from,
  fee: 100, tickSpacing: 1, sqrtPriceX96: 1n << 96n, tick: 0, liquidity: 100n, initialized: true }
const draft = { from, to, pool, amount: '0.000001', minimum: '0.000001', expiry: '2030-01-01T00:00:00Z' }
function fixture() {
  const account = privateKeyToAccount(generatePrivateKey()), hash = `0x${'ab'.repeat(32)}` as Hex
  const order = draftOrder(draft, deployment, account.address, '1', 1n)
  let allowed = 1n, current: TradeIdentity | undefined
  const submitted: Transaction[] = [], signed: unknown[] = []
  const provider: TradeIdentity['provider'] = { request: vi.fn(async ({ method, params }) => {
    if (method === 'eth_accounts') return [account.address]
    if (method === 'eth_chainId') return '0xc4'
    if (method === 'eth_sendTransaction') {
      const tx = (params as unknown[])[0] as Transaction; submitted.push(tx)
      if (tx.to === order.inputToken) allowed = decodeFunctionData({ abi: erc20Abi, data: tx.data }).args[1] as bigint
      return hash
    }
    if (method === 'eth_signTypedData_v4') {
      const typed = JSON.parse((params as string[])[1]); signed.push(typed)
      return account.signTypedData(typed)
    }
    throw Error(method)
  }) }
  const identity: TradeIdentity = { provider, address: account.address, chainId: 196, revision: 1 }; current = identity
  const read: PublicRpc = vi.fn(async (method, params) => {
    if (method === 'eth_chainId') return '0xc4'
    if (method === 'eth_getBlockByNumber') return { timestamp: '0x64' }
    if (method === 'eth_estimateGas') return '0x186a0'
    if (method === 'eth_gasPrice') return '0x1'
    if (method === 'eth_getBalance') return '0xde0b6b3a7640000'
    if (method === 'eth_call') {
      const tx = params?.[0] as Transaction
      if (tx.to === settlement) return encodeFunctionResult({ abi: orderReadAbi, functionName: 'nonceStatus', result: 0 })
      const call = decodeFunctionData({ abi: erc20Abi, data: tx.data })
      return call.functionName === 'allowance' ? encodeFunctionResult({ abi: erc20Abi, functionName: 'allowance', result: allowed })
        : encodeFunctionResult({ abi: erc20Abi, functionName: 'approve', result: true })
    }
    throw Error(method)
  })
  return { order, identity, provider, submitted, signed, change: () => { current = undefined },
    context: { identity, getIdentity: () => current, isCurrentForm: () => true, read, wait: vi.fn(async () => {}), onProgress: vi.fn() } }
}
describe('limit order wallet boundary', () => {
  it('requires an explicit ready test deployment and fixed service origin', () => {
    expect(orderDeployment(base)).toEqual(deployment)
    for (const change of [{ settlement: null }, { chainId: 1 }, { stage: 'production' }, { executionEnabled: false }, { apiOrigin: 'https://example.com/redirect' }, { apiOrigin: 'http://example.com' }])
      expect(orderDeployment({ ...base, ...change })).toBeUndefined()
  })
  it('preserves the selected minimum exactly and requires explicit future expiry', () => {
    const maker = '0x2222222222222222222222222222222222222222'
    const order = draftOrder(draft, deployment, maker, '42', 1n)
    expect(order.amountIn).toBe('1000000000000'); expect(order.minAmountOut).toBe('1')
    for (const change of [{ expiry: '' }, { expiry: '1970-01-01T00:00:01Z' }, { from: { ...from, native: true } }, { minimum: '0.0000001' }])
      expect(() => draftOrder({ ...draft, ...change }, deployment, maker, '42', 1n)).toThrow()
  })
  it('signs a verifiable Permit2 witness after exact ERC20 approvals, without a Router allowance', async () => {
    const f = fixture(), signature = await signLimitOrder(f.order, deployment, f.context)
    expect(await verifyTypedData({ ...orderTypedData(f.order, CONTRACTS.permit2), address: f.identity.address, signature })).toBe(true)
    expect(f.submitted).toHaveLength(2)
    expect(f.submitted.map(tx => decodeFunctionData({ abi: erc20Abi, data: tx.data }).args)).toEqual([[CONTRACTS.permit2, 0n], [CONTRACTS.permit2, BigInt(f.order.amountIn)]])
    expect(f.signed).toHaveLength(1)
  })
  it('does not publish a signature after the wallet changes during its signing prompt', async () => {
    const f = fixture(), original = f.provider.request
    f.provider.request = async (args) => { const result = await original(args); if (args.method === 'eth_signTypedData_v4') f.change(); return result }
    await expect(signLimitOrder(f.order, deployment, f.context)).rejects.toThrow('tradeIdentityChanged')
  })
  it('cancels on chain with the maker wallet and signed nonce', async () => {
    const f = fixture(); await cancelLimitOrder(f.order, deployment, f.context)
    expect(f.submitted).toHaveLength(1)
    expect(decodeFunctionData({ abi: orderReadAbi, data: f.submitted[0].data })).toEqual({ functionName: 'cancel', args: [1n] })
    expect(f.submitted[0].to).toBe(settlement)
  })
  it('rejects API records with a changed signed field or settlement', () => {
    const f = fixture(), value = { id: hashTypedData(orderTypedData(f.order, CONTRACTS.permit2)), order: f.order, status: 'open', reason: null, txHash: null, createdAt: 1, updatedAt: 2, observation: null }
    expect(decodeOrder(value, deployment).order.nonce).toBe('1')
    expect(() => decodeOrder({ ...value, order: { ...f.order, minAmountOut: '2' } }, deployment)).toThrow('digest')
    expect(() => decodeOrder({ ...value, order: { ...f.order, settlement: zeroAddress } }, deployment)).toThrow()
    const changed: SodaLimitOrder = { ...f.order, receiver: settlement }
    expect(() => decodeOrder({ ...value, order: changed }, deployment)).toThrow()
  })
})
