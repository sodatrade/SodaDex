import { decodeFunctionData, encodeFunctionResult, zeroAddress, type Hex } from 'viem'
import { vi } from 'vitest'
import { WOKB_ADDRESS } from '../src/domain/assets'
import { factoryAbi, poolAbi, stateAbi } from '../src/liquidity/abis'
import { LP_CONTRACTS } from '../src/liquidity/config'
import { poolId } from '../src/liquidity/pools'
import type { Currency, LiquidityPool } from '../src/liquidity/types'
import { erc20Abi, permit2Abi, v3QuoterAbi, v4QuoterAbi } from '../src/trading/abis'
import { CONTRACTS } from '../src/trading/config'
import type { PoolTradeQuote } from '../src/trading/poolTrade'
import type { PublicRpc, TradeIdentity, TradeProgress, Transaction } from '../src/trading/types'
export const owner = '0x9999999999999999999999999999999999999999' as const
export const poolAddress = '0x3333333333333333333333333333333333333333' as const
export const hash = `0x${'a'.repeat(64)}` as Hex
export const tokenA: Currency = { address: '0x1111111111111111111111111111111111111111', symbol: 'A', name: 'Token A', decimals: 18, native: false }
export const tokenB: Currency = { ...tokenA, address: '0x2222222222222222222222222222222222222222', symbol: 'B', decimals: 6 }
export function selectedPool(protocol: 'v3' | 'v4', native = false): LiquidityPool {
  const pool: LiquidityPool = { protocol, id: poolAddress, address: protocol === 'v3' ? poolAddress : undefined,
    currency0: native && protocol === 'v4' ? { ...tokenA, address: zeroAddress, symbol: 'OKB', native: true } : tokenA,
    currency1: native ? protocol === 'v3' ? { ...tokenB, address: WOKB_ADDRESS, symbol: 'OKB', native: true } : tokenB : tokenB,
    fee: 500, tickSpacing: 10, sqrtPriceX96: 2n ** 96n, tick: 0, liquidity: 1000n, initialized: true }
  if (protocol === 'v4') pool.id = poolId(pool)
  return pool
}
export function reviewed(pool: LiquidityPool, zeroForOne = true): PoolTradeQuote {
  return { pool, zeroForOne, amount: 1000n, amountOut: 1000n, minimumOut: 995n, slippageBps: 50 }
}
export function tradeFixture(pool: LiquidityPool) {
  let tokenAllowed = 0n, permitAllowed = 0n, expiration = 0
  const submitted: Transaction[] = [], events: TradeProgress[] = []
  const provider = { request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === 'eth_accounts') return [owner]
    if (method === 'eth_chainId') return '0xc4'
    if (method !== 'eth_sendTransaction') throw new Error(method)
    const tx = params?.[0] as Transaction
    submitted.push(tx)
    if (tx.to.toLowerCase() === pool.currency0.address.toLowerCase() || tx.to.toLowerCase() === pool.currency1.address.toLowerCase()) {
      if (tx.data.startsWith('0x095ea7b3')) {
        const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data })
        if (decoded.functionName === 'approve') tokenAllowed = decoded.args[1]
      }
    }
    if (tx.to === CONTRACTS.permit2) {
      const decoded = decodeFunctionData({ abi: permit2Abi, data: tx.data })
      if (decoded.functionName === 'approve') { permitAllowed = decoded.args[2]; expiration = decoded.args[3] }
    }
    return hash
  }) }
  const identity: TradeIdentity = { address: owner, chainId: 196, provider, revision: 1 }
  const read = vi.fn<PublicRpc>(async (method, params) => {
    if (method === 'eth_chainId') return '0xc4'
    if (method === 'eth_blockNumber') return '0x10'
    if (method === 'eth_getBlockByNumber') return { timestamp: '0x3e8' }
    if (method === 'eth_getBalance') return '0x100000000000000000000'
    if (method === 'eth_estimateGas') return '0x10000'
    if (method === 'eth_gasPrice') return '0x1'
    if (method !== 'eth_call') throw new Error(method)
    const tx = params?.[0] as { to: string; data: Hex }
    if (tx.to === LP_CONTRACTS.factory) {
      const decoded = decodeFunctionData({ abi: factoryAbi, data: tx.data })
      return decoded.functionName === 'getPool'
        ? encodeFunctionResult({ abi: factoryAbi, functionName: 'getPool', result: poolAddress })
        : encodeFunctionResult({ abi: factoryAbi, functionName: 'feeAmountTickSpacing', result: 10 })
    }
    if (tx.to === poolAddress) {
      const { functionName } = decodeFunctionData({ abi: poolAbi, data: tx.data })
      if (functionName === 'slot0') return encodeFunctionResult({ abi: poolAbi, functionName, result: [2n ** 96n, 0, 0, 0, 0, 0, true] })
      if (functionName === 'liquidity') return encodeFunctionResult({ abi: poolAbi, functionName, result: 1000n })
    }
    if (tx.to === LP_CONTRACTS.stateView) {
      const { functionName } = decodeFunctionData({ abi: stateAbi, data: tx.data })
      if (functionName === 'getSlot0') return encodeFunctionResult({ abi: stateAbi, functionName, result: [2n ** 96n, 0, 0, pool.fee] })
      if (functionName === 'getLiquidity') return encodeFunctionResult({ abi: stateAbi, functionName, result: 1000n })
    }
    if (tx.to === CONTRACTS.v3Quoter) return encodeFunctionResult({ abi: v3QuoterAbi, functionName: 'quoteExactInputSingle', result: [1000n, 0n, 0, 0n] })
    if (tx.to === CONTRACTS.v4Quoter) return encodeFunctionResult({ abi: v4QuoterAbi, functionName: 'quoteExactInputSingle', result: [1000n, 0n] })
    if (tx.data.startsWith('0xdd62ed3e')) return encodeFunctionResult({ abi: erc20Abi, functionName: 'allowance', result: tokenAllowed })
    if (tx.to === CONTRACTS.permit2 && tx.data.startsWith('0x927da105')) return encodeFunctionResult({ abi: permit2Abi, functionName: 'allowance', result: [permitAllowed, expiration, 0] })
    return '0x'
  })
  const wait = vi.fn(async () => {})
  return { read, identity, submitted, events, wait, setToken: (n: bigint) => { tokenAllowed = n },
    context: { identity, getIdentity: () => identity, isCurrentForm: () => true, onProgress: (p: TradeProgress) => events.push(p), read, wait } }
}
