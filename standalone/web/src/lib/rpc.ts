import { ASSETS, CHAIN_ID, type AssetId } from '../domain/assets'

export type ReadMethod =
  | 'eth_chainId'
  | 'eth_blockNumber'
  | 'eth_getBalance'
  | 'eth_call'
  | 'eth_getBlockByNumber'
  | 'eth_estimateGas'
  | 'eth_getTransactionReceipt'
  | 'eth_gasPrice'
  | 'eth_getCode'
  | 'eth_getLogs'

export function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

export function hexQuantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error('节点返回了无法识别的数据')
  }
  return BigInt(value)
}

export async function rpc(method: ReadMethod, params: unknown[] = []): Promise<unknown> {
  const response = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) {
    throw new Error('暂时无法连接 X Layer 节点')
  }
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('result' in body) || 'error' in body) {
    throw new Error('节点请求未完成，请稍后重试')
  }
  return body.result
}

export async function getNetworkStatus(): Promise<{ block: bigint }> {
  const chain = hexQuantity(await rpc('eth_chainId'))
  if (chain !== BigInt(CHAIN_ID)) {
    throw new Error('节点网络与 X Layer 不一致')
  }
  return { block: hexQuantity(await rpc('eth_blockNumber')) }
}

export async function getBalances(address: string): Promise<Record<AssetId, bigint>> {
  if (!isAddress(address)) {
    throw new Error('钱包地址格式不正确')
  }
  const balances = await Promise.all(
    ASSETS.map(async (asset) => {
      const result =
        asset.id === 'okb'
          ? await rpc('eth_getBalance', [address, 'latest'])
          : await rpc('eth_call', [
              { to: asset.address, data: `0x70a08231${address.slice(2).toLowerCase().padStart(64, '0')}` },
              'latest',
            ])
      return [asset.id, hexQuantity(result)] as const
    }),
  )
  return Object.fromEntries(balances) as Record<AssetId, bigint>
}
