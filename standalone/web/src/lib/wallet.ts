import { CHAIN_ID, EXPLORER_URL, RPC_URL } from '../domain/assets'
import { hexQuantity, isAddress } from './rpc'

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, listener: (value: unknown) => void) => void
  removeListener?: (event: string, listener: (value: unknown) => void) => void
}

export interface WalletOption {
  id: string
  name: string
  provider: Eip1193Provider
}

export interface WalletSession extends WalletOption {
  address: `0x${string}`
  chainId: number
}

export function isProvider(value: unknown): value is Eip1193Provider {
  return (
    typeof value === 'object' &&
    value !== null &&
    'request' in value &&
    typeof value.request === 'function' &&
    (!('on' in value) || value.on === undefined || typeof value.on === 'function') &&
    (!('removeListener' in value) || value.removeListener === undefined || typeof value.removeListener === 'function')
  )
}

export function firstAccount(value: unknown): `0x${string}` | undefined {
  return Array.isArray(value) && isAddress(value[0]) ? value[0] : undefined
}

export function providerChainId(value: unknown): number {
  const quantity = hexQuantity(value)
  if (quantity > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('钱包返回了无法识别的网络')
  }
  return Number(quantity)
}

export async function connectWallet(option: WalletOption): Promise<WalletSession> {
  const address = firstAccount(await option.provider.request({ method: 'eth_requestAccounts' }))
  if (!address) {
    throw new Error('钱包未提供可连接的账户')
  }
  const chainId = providerChainId(await option.provider.request({ method: 'eth_chainId' }))
  return { ...option, address, chainId }
}

export async function switchToXLayer(provider: Eip1193Provider): Promise<number> {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xc4' }] })
  } catch (error: unknown) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 4902) {
      throw error
    }
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: '0xc4',
          chainName: 'X Layer',
          nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
          rpcUrls: [RPC_URL],
          blockExplorerUrls: [EXPLORER_URL],
        },
      ],
    })
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xc4' }] })
  }
  const chainId = providerChainId(await provider.request({ method: 'eth_chainId' }))
  if (chainId !== CHAIN_ID) {
    throw new Error('钱包尚未切换到 X Layer')
  }
  return chainId
}

export function walletError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  if (code === 4001) {
    return '已取消钱包请求，可以重新连接。'
  }
  if (code === -32002) {
    return '钱包已有待处理请求，请先打开钱包完成操作。'
  }
  return '钱包请求未完成，请检查钱包后重试。'
}
