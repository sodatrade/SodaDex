import { BaseError, ContractFunctionRevertedError, TransactionReceiptNotFoundError, createPublicClient, decodeErrorResult, decodeEventLog, encodeFunctionData, hashStruct, hashTypedData, http, verifyTypedData, type Address, type Hex, type PublicClient } from 'viem'
import { orderMessage, orderTypedData, ORDER_TYPES, type SodaLimitOrder } from '../../order-types.ts'
import { SETTLEMENT_ABI, PERMIT_ABI } from './abi.ts'
import { FIXED, type OrdersConfig } from './config.ts'
import { ChainFailure, type ExecutionPlan, type ExecutionReceipt, type NonceObservation, type OrderChain } from './chain-types.ts'
import type { ChainObservation } from './types.ts'
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
export function orderId(order: SodaLimitOrder): Hex { return hashTypedData(orderTypedData(order, FIXED.permit2)) }
export function orderHash(order: SodaLimitOrder): Hex { return hashStruct({ data: orderMessage(order), primaryType: 'SodaLimitOrder', types: ORDER_TYPES }) }
export function executionData(order: SodaLimitOrder, signature: Hex): Hex { return encodeFunctionData({ abi: SETTLEMENT_ABI, functionName: 'execute', args: [orderMessage(order), signature] }) }
function observation(block: { number: bigint | null; hash: Hex | null; timestamp: bigint }): ChainObservation {
  const timestamp = Number(block.timestamp)
  if (block.number === null || !block.hash || !Number.isSafeInteger(timestamp)) throw new ChainFailure('unavailable')
  return { blockNumber: String(block.number), blockHash: block.hash, timestamp }
}
function minimumFailure(error: ContractFunctionRevertedError): boolean {
  const failure = error.data
  if (!failure) return false
  if (['OutputAmountMismatch', 'V3TooLittleReceived', 'V4TooLittleReceived'].includes(failure.errorName)) return true
  if (failure.errorName !== 'ExecutionFailed') return false
  const raw = failure.args?.[1]
  if (typeof raw !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(raw)) return false
  try {
    const inner = decodeErrorResult({ abi: SETTLEMENT_ABI, data: raw as Hex })
    return inner.errorName === 'V3TooLittleReceived' || inner.errorName === 'V4TooLittleReceived'
  } catch { return false }
}
export class ViemOrderChain implements OrderChain {
  readonly client: PublicClient
  readonly config: OrdersConfig
  constructor(config: OrdersConfig, client?: PublicClient) {
    this.config = config
    this.client = client ?? createPublicClient({ transport: http(config.rpcUrl, { timeout: 12_000, retryCount: 0, fetchOptions: { redirect: 'error' } }) })
  }
  private async confirmObservation(at: ChainObservation): Promise<void> {
    const current = await this.client.getBlock({ blockNumber: BigInt(at.blockNumber) })
    if (!current.hash || !same(current.hash, at.blockHash)) throw new ChainFailure('unavailable')
  }
  async ready(): Promise<boolean> {
    if (this.config.settlement === null) return false
    try {
      const address = this.config.settlement
      const code = await this.client.getBytecode({ address })
      if (await this.client.getChainId() !== 196 || !code || code === '0x') return false
      const names = ['PERMIT2', 'WOKB', 'ROUTER', 'FACTORY', 'POOL_MANAGER', 'STATE_VIEW'] as const
      const expected = [FIXED.permit2, FIXED.wrappedNative, FIXED.router, FIXED.factory, FIXED.poolManager, FIXED.stateView]
      const constants = await Promise.all(names.map(functionName => this.client.readContract({ address, abi: SETTLEMENT_ABI, functionName })))
      const [chainId, test] = await Promise.all([this.client.readContract({ address, abi: SETTLEMENT_ABI, functionName: 'CHAIN_ID' }), this.client.readContract({ address, abi: SETTLEMENT_ABI, functionName: 'TEST_DEPLOYMENT' })])
      return chainId === 196n && test && constants.every((value, index) => same(value, expected[index]))
    } catch { throw new ChainFailure('unavailable') }
  }
  async observe(order: SodaLimitOrder): Promise<NonceObservation> {
    try {
      const block = observation(await this.client.getBlock({ blockTag: 'latest' }))
      const blockNumber = BigInt(block.blockNumber)
      const nonce = BigInt(order.nonce)
      const [status, bitmap] = await Promise.all([
        this.client.readContract({ address: order.settlement, abi: SETTLEMENT_ABI, functionName: 'nonceStatus', args: [order.maker, nonce], blockNumber }),
        this.client.readContract({ address: FIXED.permit2, abi: PERMIT_ABI, functionName: 'nonceBitmap', args: [order.maker, nonce >> 8n], blockNumber }),
      ])
      if (![0, 1, 2].includes(status)) throw new ChainFailure('unavailable')
      await this.confirmObservation(block)
      return { observation: block, nonceStatus: status as 0 | 1 | 2, permitNonceUsed: (bitmap & (1n << (nonce & 255n))) !== 0n }
    } catch { throw new ChainFailure('unavailable') }
  }
  async verifySignature(order: SodaLimitOrder, signature: Hex, at: ChainObservation): Promise<boolean> {
    try {
      const blockNumber = BigInt(at.blockNumber)
      const code = await this.client.getBytecode({ address: order.maker, blockNumber })
      if (!code || code === '0x') {
        if (signature.length !== 130 && signature.length !== 132) return false
        try { if (!await verifyTypedData({ address: order.maker, ...orderTypedData(order, FIXED.permit2), signature })) return false } catch { return false }
      }
      const digest = await this.client.readContract({ address: order.settlement, abi: SETTLEMENT_ABI, functionName: 'orderDigest', args: [orderMessage(order)], blockNumber })
      const valid = same(digest, orderId(order)) && await this.client.verifyTypedData({ address: order.maker, ...orderTypedData(order, FIXED.permit2), signature, blockNumber })
      await this.confirmObservation(at)
      return valid
    } catch { throw new ChainFailure('unavailable') }
  }
  async simulate(order: SodaLimitOrder, signature: Hex, executor: Address): Promise<bigint> {
    try {
      const result = await this.client.simulateContract({ address: order.settlement, abi: SETTLEMENT_ABI, functionName: 'execute', args: [orderMessage(order), signature], account: executor })
      if (result.result < BigInt(order.minAmountOut)) throw new ChainFailure('price')
      return result.result
    } catch (error) {
      if (error instanceof ChainFailure) throw error
      const reverted = error instanceof BaseError ? error.walk(value => value instanceof ContractFunctionRevertedError) : null
      throw new ChainFailure(reverted instanceof ContractFunctionRevertedError && minimumFailure(reverted) ? 'price' : 'simulation')
    }
  }
  async plan(order: SodaLimitOrder, signature: Hex, executor: Address): Promise<ExecutionPlan> {
    try {
      const data = executionData(order, signature)
      const [gas, gasPrice, nonce] = await Promise.all([this.client.estimateGas({ account: executor, to: order.settlement, data, value: 0n }), this.client.getGasPrice(), this.client.getTransactionCount({ address: executor, blockTag: 'pending' })])
      return { chainId: 196, to: order.settlement, data, value: 0n, nonce, gas, gasPrice }
    } catch { throw new ChainFailure('unavailable') }
  }
  async receipt(hash: Hex, order: SodaLimitOrder): Promise<ExecutionReceipt | null> {
    try {
      const receipt = await this.client.getTransactionReceipt({ hash })
      if (!same(receipt.transactionHash, hash)) throw new ChainFailure('unavailable')
      const block = observation(await this.client.getBlock({ blockNumber: receipt.blockNumber }))
      if (!same(block.blockHash, receipt.blockHash)) return null
      const filled = receipt.logs.some(log => {
        if (!same(log.address, order.settlement)) return false
        try {
          const event = decodeEventLog({ abi: SETTLEMENT_ABI, topics: log.topics, data: log.data, strict: true })
          if (event.eventName !== 'OrderFilled') return false
          const p = event.args
          return same(p.orderHash, orderHash(order)) && same(p.maker, order.maker) && p.nonce === BigInt(order.nonce) && same(p.inputToken, order.inputToken) && same(p.outputToken, order.outputToken) && p.amountIn === BigInt(order.amountIn) && p.amountOut >= BigInt(order.minAmountOut) && same(p.receiver, order.receiver)
        } catch { return false }
      })
      return { hash, succeeded: receipt.status === 'success', gasCostWei: receipt.gasUsed * receipt.effectiveGasPrice, observation: block, filled }
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return null
      throw new ChainFailure('unavailable')
    }
  }
  async broadcast(rawTransaction: Hex): Promise<Hex> {
    try { return await this.client.sendRawTransaction({ serializedTransaction: rawTransaction }) } catch { throw new ChainFailure('unavailable') }
  }
}
