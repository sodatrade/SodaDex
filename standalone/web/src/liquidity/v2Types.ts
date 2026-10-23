import type { Address } from 'viem'
import type { Currency, LiquidityPool } from './types'

export interface V2Pool {
  protocol: 'v2'
  id: Address
  address?: Address
  currency0: Currency
  currency1: Currency
  fee: 3000
  reserve0: bigint
  reserve1: bigint
  totalSupply: bigint
  kLast: bigint
  feeOn: boolean
  initialized: boolean
}
export type AnyPool = LiquidityPool | V2Pool
export interface V2Position {
  pool: V2Pool
  owner: Address
  balance: bigint
  amount0: bigint
  amount1: bigint
}
