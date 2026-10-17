import { NETWORK } from '../network'

export type ReadMethod =
  | 'eth_chainId' | 'eth_blockNumber' | 'eth_getBalance' | 'eth_call' | 'eth_getBlockByNumber'
  | 'eth_estimateGas' | 'eth_getTransactionReceipt' | 'eth_gasPrice' | 'eth_getCode' | 'eth_getLogs'

export function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

export function hexQuantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) throw new Error('节点返回了无法识别的数据')
  return BigInt(value)
}

export async function rpc(method: ReadMethod, params: unknown[] = []): Promise<unknown> {
  const response = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SodaDEX-Network-Profile': NETWORK.id },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error('暂时无法连接 X Layer 节点')
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('result' in body) || 'error' in body)
    throw new Error('节点请求未完成，请稍后重试')
  return body.result
}
