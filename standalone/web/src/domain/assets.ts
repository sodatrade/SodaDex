import { NETWORK } from '../network'

// This legacy DEX asset list has no 1952 deployment. Keep it out of the mining entry.
if (!NETWORK.dexEnabled || NETWORK.chainId !== 196) throw new Error('DEX assets are not deployed for this network profile')

export type AssetId = 'okb' | 'wokb' | 'usdt0'

export interface Asset {
  id: AssetId
  symbol: string
  name: string
  decimals: 18 | 6
  address: `0x${string}` | null
  description: string
}

export const CHAIN_ID = NETWORK.chainId
export { RPC_URL, EXPLORER_URL } from '../network'
export const WOKB_ADDRESS = '0xe538905cf8410324e03A5A23C1c177a474D59b2b' as const

export const STABLE_ADDRESS = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736' as const

export const ASSETS: readonly Asset[] = [
  { id: 'okb', symbol: 'OKB', name: 'OKB', decimals: 18, address: null, description: 'X Layer 原生资产' },
  {
    id: 'wokb',
    symbol: 'WOKB',
    name: 'Wrapped OKB',
    decimals: 18,
    address: WOKB_ADDRESS,
    description: '包装后的 OKB · ERC-20',
  },
  { id: 'usdt0', symbol: 'USD₮0', name: 'USD₮0', decimals: 6, address: STABLE_ADDRESS, description: 'USD₮0 · ERC-20' },
]

export type Protocol = 'auto' | 'v3' | 'v4'
export const PROTOCOL_NAMES: Record<Protocol, string> = { auto: '自动', v3: 'V3', v4: 'V4' }

export function getAsset(id: AssetId): Asset {
  return ASSETS.find((asset) => asset.id === id) ?? ASSETS[0]
}

export { shortenAddress } from '../lib/address'
