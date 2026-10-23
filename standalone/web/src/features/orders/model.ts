import { zeroAddress } from 'viem'
import { parseLimitOrder, type SodaLimitOrder } from '../../../../order-types'
import { parseAmount } from '../../domain/amount'
import { WOKB_ADDRESS } from '../../domain/assets'
import type { Currency, LiquidityPool } from '../../liquidity/types'
import { CONTRACTS } from '../../trading/config'
import type { OrderDeployment } from './config'
export interface LimitDraft { from: Currency; to: Currency; pool: LiquidityPool; amount: string; minimum: string; expiry: string }
export function draftOrder(draft: LimitDraft, deployment: OrderDeployment, maker: SodaLimitOrder['maker'], nonce: string, now: bigint): SodaLimitOrder {
  if (draft.from.native || !draft.pool.initialized || !['v3', 'v4'].includes(draft.pool.protocol)) throw Error('invalidDraft')
  const amount = parseAmount(draft.amount, draft.from.decimals), minimum = parseAmount(draft.minimum, draft.to.decimals)
  const expiryMs = Date.parse(draft.expiry)
  if (amount.kind !== 'valid' || minimum.kind !== 'valid' || !Number.isFinite(expiryMs)) throw Error('invalidDraft')
  return parseLimitOrder({ chainId: 196, settlement: deployment.settlement, maker, inputToken: draft.from.address,
    outputToken: draft.to.native ? zeroAddress : draft.to.address, amountIn: String(amount.units), minAmountOut: String(minimum.units),
    receiver: maker, nonce, expiry: String(Math.floor(expiryMs / 1000)), protocol: draft.pool.protocol === 'v3' ? 3 : 4,
    pool: { currency0: draft.pool.currency0.address, currency1: draft.pool.currency1.address, fee: draft.pool.fee,
      tickSpacing: draft.pool.tickSpacing, hooks: zeroAddress } }, { ...CONTRACTS, settlement: deployment.settlement, wrappedNative: WOKB_ADDRESS }, now)
}
export function orderNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return BigInt(`0x${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`).toString()
}
