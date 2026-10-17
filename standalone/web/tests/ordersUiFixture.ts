import { decodeFunctionData, encodeFunctionResult, hashTypedData, type Hex } from 'viem'
import { vi } from 'vitest'
import { orderTypedData, type SodaLimitOrder } from '../../order-types'
import type { PublicOrder } from '../src/features/orders/api'
import type { OrderDeployment } from '../src/features/orders/config'
import { orderReadAbi } from '../src/features/orders/signing'
import { WOKB_ADDRESS } from '../src/domain/assets'
import type { WalletController } from '../src/lib/useWallet'
import type { WalletIdentity } from '../src/lib/wallet'
import { erc20Abi } from '../src/trading/abis'
import { CONTRACTS } from '../src/trading/config'
import { marketHash, marketOwner } from './tradeMarketFixture'
export const orderDeployment: OrderDeployment = { chainId: 196, settlement: '0x7777777777777777777777777777777777777777', deploymentBlock: 1, apiOrigin: 'http://localhost:8792', executionEnabled: true }
export function orderUiFixture() {
  let allowed = 0n, receiptTo: Hex = WOKB_ADDRESS, identity: WalletIdentity | undefined
  const methods: string[] = [], records: PublicOrder[] = []
  let ready = true, timeout = false, missing = false, estimateFails = false
  const provider = { request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] | object }) => {
    methods.push(method)
    if (method === 'eth_accounts') return [marketOwner]
    if (method === 'eth_chainId') return '0xc4'
    if (method === 'eth_signTypedData_v4') return `0x${'11'.repeat(65)}`
    if (method === 'eth_sendTransaction') {
      const tx = (params as { to: Hex; data: Hex }[])[0]; receiptTo = tx.to
      if (tx.to.toLowerCase() === WOKB_ADDRESS.toLowerCase()) allowed = decodeFunctionData({ abi: erc20Abi, data: tx.data }).args[1] as bigint
      return marketHash
    }
    throw Error(method)
  }) }
  identity = { address: marketOwner, chainId: 196, provider, revision: 1 }
  const wallet: WalletController = { session: { ...identity, id: 'fixture', name: 'Fixture wallet' }, getIdentity: () => identity,
    status: 'idle', options: [], error: undefined, connect: vi.fn(), switchChain: vi.fn(), disconnect: vi.fn() }
  const record = (order: SodaLimitOrder): PublicOrder => ({ id: hashTypedData(orderTypedData(order, CONTRACTS.permit2)), order, status: 'open', reason: 'awaiting_price', txHash: null, createdAt: 1, updatedAt: 1, observation: null })
  const fetcher = vi.fn(async (path: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
    const url = String(path), json = (value: unknown): Response => new Response(JSON.stringify(value))
    if (url.startsWith('/api/reference/')) return json({ schemaVersion: 1, chainId: 196, source: 'uniswap', readOnly: true, tokens: [] })
    if (url === '/api/orders/status') return json({ schemaVersion: 1, service: 'sodadex-orders', chainId: 196, testDeployment: true, settlement: orderDeployment.settlement,
      permit2: CONTRACTS.permit2, wrappedNative: WOKB_ADDRESS, reason: null, executionEnabled: ready, acceptingOrders: ready })
    if (url === '/api/orders' && options?.method === 'POST') {
      const body = JSON.parse(String(options.body)) as { order: SodaLimitOrder; signature: Hex }
      const result = record(body.order); records.push(result)
      if (timeout) throw Error('network timeout')
      return json({ schemaVersion: 1, order: result })
    }
    if (url.startsWith('/api/orders/0x')) return missing || !records[0] ? new Response('{}', { status: 404 }) : json({ schemaVersion: 1, order: records[0] })
    if (url.startsWith('/api/orders?')) return json({ schemaVersion: 1, orders: records, nextCursor: null })
    const body = JSON.parse(String(options?.body)) as { method: string; params?: unknown[] }
    let result: unknown
    if (body.method === 'eth_chainId') result = '0xc4'
    else if (body.method === 'eth_getBlockByNumber') result = { timestamp: '0x64' }
    else if (body.method === 'eth_estimateGas') { if (estimateFails) throw Error('gas unavailable'); result = '0x186a0' }
    else if (body.method === 'eth_gasPrice') result = '0x1'
    else if (body.method === 'eth_getBalance') result = '0xde0b6b3a7640000'
    else if (body.method === 'eth_getTransactionReceipt') result = { transactionHash: marketHash, from: marketOwner, to: receiptTo, blockHash: marketHash, status: '0x1' }
    else if (body.method === 'eth_call') {
      const tx = body.params?.[0] as { to: Hex; data: Hex }
      if (tx.data.startsWith('0x70a08231')) result = `0x${(10n ** 18n).toString(16)}`
      else if (tx.to.toLowerCase() === orderDeployment.settlement.toLowerCase()) result = encodeFunctionResult({ abi: orderReadAbi, functionName: 'nonceStatus', result: 0 })
      else { const call = decodeFunctionData({ abi: erc20Abi, data: tx.data }); result = call.functionName === 'allowance'
        ? encodeFunctionResult({ abi: erc20Abi, functionName: 'allowance', result: allowed }) : encodeFunctionResult({ abi: erc20Abi, functionName: 'approve', result: true }) }
    } else throw Error(body.method)
    return json({ result })
  })
  return { wallet, provider, methods, records, fetcher, record, change: () => { identity = { ...identity!, revision: 2, address: '0x2222222222222222222222222222222222222222' }; wallet.session = { ...wallet.session!, ...identity } },
    notReady: () => { ready = false }, timeout: () => { timeout = true }, missing: () => { missing = true }, failGas: () => { estimateFails = true } }
}
