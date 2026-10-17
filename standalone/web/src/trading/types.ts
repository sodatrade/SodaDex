import type { Address, Hex } from 'viem'
import type { AssetId } from '../domain/assets'
import type { ReadMethod } from '../lib/rpc'
import type { WalletIdentity } from '../lib/wallet'
export type RouteProtocol = 'v3' | 'v4'
export interface TradeForm {
  from: AssetId
  to: AssetId
  amount: bigint
}
export interface Quote extends TradeForm {
  protocol: RouteProtocol
  amountOut: bigint
  minimumOut: bigint
}
export interface Transaction {
  from: Address
  to: Address
  data: Hex
  value: Hex
}
export type PublicRpc = (method: ReadMethod, params?: unknown[]) => Promise<unknown>
export type TradeIdentity = WalletIdentity
export type TradeErrorCode =
  | 'tradeReviewAgain'
  | 'tradeNotReady'
  | 'tradePaused'
  | 'tradeUnsupported'
  | 'tradeUnavailable'
  | 'tradeIdentityChanged'
  | 'tradeQuoteChanged'
  | 'tradeRejected'
  | 'tradeReverted'
  | 'tradePending'
  | 'tradeFailed'
  | 'tradeGasBalance'
  | 'tradeExpired'
export class TradeError extends Error {
  constructor(public readonly code: TradeErrorCode) {
    super(code)
    this.name = 'TradeError'
  }
}
export type TradeStage =
  | 'tradePreparing'
  | 'tradeResetApproval'
  | 'tradeTokenApproval'
  | 'tradePermitApproval'
  | 'tradeRefreshing'
  | 'tradeSimulating'
  | 'tradeSending'
  | 'tradeConfirming'
  | 'tradeSucceeded'
export interface TradeProgress {
  stage: TradeStage
  hash?: Hex
  kind?: 'approval' | 'swap'
  to?: Address
}
export function tradeError(cause: unknown): TradeErrorCode {
  if (cause instanceof TradeError) return cause.code
  if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 4001) return 'tradeRejected'
  return 'tradeFailed'
}
