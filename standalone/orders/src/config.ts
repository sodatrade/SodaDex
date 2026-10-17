import { resolve } from 'node:path'
import type { Address } from 'viem'
export const FIXED = {
  chainId: 196 as const,
  rpcUrl: 'https://rpc.ignix.bot/rpc/196',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address,
  wrappedNative: '0xe538905cf8410324e03A5A23C1c177a474D59b2b' as Address,
  router: '0xda5Bc8bc981d9b2F5df2b0c7E5aeD044993709FA' as Address,
  factory: '0xa6109B7F4237d2aC28B8009FbD21B88cff194cFe' as Address,
  poolManager: '0x6B5C32aD97EB42230138e02a21B0E6d811FD713D' as Address,
  stateView: '0x7991D4a8493b9709365cD079DfFc75e790007874' as Address,
}
export interface OrdersConfig {
  settlement: Address | null; rpcUrl: string; publicOrigin: string; databasePath: string
  executionEnabled: boolean; gasBudgetWei: bigint; localTest: boolean
}
export function validateConfig(config: OrdersConfig): OrdersConfig {
  const rpc = new URL(config.rpcUrl), origin = new URL(config.publicOrigin)
  if (rpc.username || rpc.password || rpc.search || rpc.hash || origin.username || origin.password || origin.origin !== config.publicOrigin) throw Error('Invalid orders service origin')
  if (config.localTest) {
    if (rpc.protocol !== 'http:' || rpc.hostname !== '127.0.0.1' || rpc.pathname !== '/') throw Error('Local order tests require an owned loopback RPC')
  } else if (config.rpcUrl !== FIXED.rpcUrl || config.settlement !== null) {
    // The tracked deployment is still null. Enabling a remote address requires a reviewed deployment manifest update.
    throw Error('Remote settlement deployment is not configured')
  }
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname))) throw Error('Orders service requires an explicit HTTPS or local origin')
  if (config.settlement !== null && (!/^0x[0-9a-fA-F]{40}$/.test(config.settlement) || /^0x0{40}$/.test(config.settlement))) throw Error('Invalid settlement configuration')
  if (config.gasBudgetWei < 0n || (config.executionEnabled && (config.settlement === null || config.gasBudgetWei === 0n))) throw Error('Execution requires a deployed settlement and explicit positive gas budget')
  return { ...config, databasePath: resolve(config.databasePath) }
}
