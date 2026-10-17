import { ASSETS, CHAIN_ID, type AssetId } from '../domain/assets'

import { hexQuantity, isAddress, rpc } from './readRpc'
export { hexQuantity, isAddress, rpc, type ReadMethod } from './readRpc'

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
