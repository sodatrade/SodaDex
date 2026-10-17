import type { Address, Hex } from 'viem'
import type { WalletIdentity } from '../lib/wallet'
import type { PublicRpc, Transaction } from '../trading/types'
export type LiquidityProtocol = 'v3' | 'v4'
/** native=true means pay/receive OKB; V3 uses its WOKB pool address internally. Amounts are raw units. */
export interface Currency {
  address: Address
  symbol: string
  name: string
  decimals: number
  native: boolean
}
export interface PoolDraft {
  protocol: LiquidityProtocol
  currencyA: Currency
  currencyB: Currency
  fee: number
  tickSpacing?: number
}
export interface LiquidityPool {
  protocol: LiquidityProtocol
  id: Hex
  address?: Address
  currency0: Currency
  currency1: Currency
  fee: number
  tickSpacing: number
  sqrtPriceX96: bigint
  tick: number
  liquidity: bigint
  initialized: boolean
}
export interface LiquidityPosition {
  protocol: LiquidityProtocol
  tokenId: bigint
  owner: Address
  pool: LiquidityPool
  tickLower: number
  tickUpper: number
  liquidity: bigint
  amount0: bigint
  amount1: bigint
  fees0: bigint
  fees1: bigint
  /** Total collectable assets; V3 stored owed amounts can include withdrawn principal. */
  claimable0: bigint
  claimable1: bigint
  inRange: boolean
}
export type LiquidityOperation =
  | {
      kind: 'mint'
      pool: LiquidityPool
      amount0: bigint
      amount1: bigint
      tickLower: number
      tickUpper: number
      initialPrice?: string
      slippageBps?: number
    }
  | { kind: 'increase'; position: LiquidityPosition; amount0: bigint; amount1: bigint; slippageBps?: number }
  | { kind: 'decrease'; position: LiquidityPosition; liquidity: bigint; liquidityBps?: number; slippageBps?: number }
  | { kind: 'collect'; position: LiquidityPosition }
  | { kind: 'transfer'; position: LiquidityPosition; recipient: Address }
  | { kind: 'burn'; position: LiquidityPosition }
export interface LiquidityPreview {
  operation: LiquidityOperation
  owner: Address
  pool: LiquidityPool
  slippageBps: number
  deadline: bigint
  liquidity: bigint
  amount0: bigint
  amount1: bigint
  minimum0: bigint
  minimum1: bigint
  maximum0: bigint
  maximum1: bigint
  transaction: Transaction
  approvals: readonly { currency: Currency; amount: bigint; spender: Address; permit2: boolean }[]
}
export type LiquidityStage =
  | 'preparing'
  | 'resetApproval'
  | 'tokenApproval'
  | 'permitApproval'
  | 'simulating'
  | 'sending'
  | 'pending'
  | 'success'
export interface LiquidityProgress {
  stage: LiquidityStage
  hash?: Hex
  kind?: 'approval' | 'liquidity'
  to?: Address
}
export interface LiquidityExecutionContext {
  identity: WalletIdentity
  getIdentity: () => WalletIdentity | undefined
  isCurrentForm?: () => boolean
  onProgress: (progress: LiquidityProgress) => void
  read?: PublicRpc
  wait?: (read: PublicRpc, hash: Hex, from: Address, to: Address) => Promise<void>
}
export type LiquidityErrorCode =
  | 'invalidCurrency'
  | 'invalidPool'
  | 'invalidRange'
  | 'invalidAmount'
  | 'invalidSlippage'
  | 'poolChanged'
  | 'identityChanged'
  | 'notOwner'
  | 'expired'
  | 'rejected'
  | 'reverted'
  | 'pending'
  | 'gasBalance'
  | 'failed'
export class LiquidityError extends Error {
  constructor(public readonly code: LiquidityErrorCode) {
    super(code)
    this.name = 'LiquidityError'
  }
}
export type { PublicRpc }
