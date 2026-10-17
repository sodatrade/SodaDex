export type AssetId = 'okb' | 'wokb' | 'usdt0'

export interface Asset {
  id: AssetId
  symbol: string
  name: string
  decimals: 18 | 6
  address: `0x${string}` | null
  description: string
}

export const CHAIN_ID = 196
export const RPC_URL = 'https://rpc.ignix.bot/rpc/196'
export const EXPLORER_URL = 'https://www.oklink.com/xlayer'
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

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
