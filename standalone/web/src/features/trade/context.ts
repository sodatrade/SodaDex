import type { AnyPool } from '../../liquidity/v2Types'
import type { Protocol } from '../../domain/assets'
import type { Currency } from '../../liquidity/types'
import type { PoolTradeQuote } from '../../trading/poolTrade'
import type { PoolExactOutputQuote } from '../../trading/poolExactOutput'
import { matchingPools, wrapDirection } from '../swap/routes'
export interface TradeMarketContext {
  from: Currency; to: Currency; protocol: Protocol; candidatePools: readonly { pool: AnyPool; zeroForOne: boolean }[]
  activePool?: AnyPool; quotePool?: AnyPool; zeroForOne?: boolean; loading: boolean; failed: boolean
  mode: 'loading' | 'unavailable' | 'empty' | 'wrap' | 'pair' | 'quote'
}
/** Market selection is read-only. It cannot select or alter the swap's reviewed transaction. */
export function marketContext(input: {
  from: Currency; to: Currency; protocol: Protocol; pools: AnyPool[] | undefined
  loading: boolean; failed: boolean; quote?: PoolTradeQuote | PoolExactOutputQuote
}): TradeMarketContext {
  const { from, to, protocol } = input
  const candidates = matchingPools(input.pools ?? [], from, to, protocol)
  const base = { from, to, protocol, candidatePools: candidates, loading: input.loading, failed: input.failed }
  if (wrapDirection(from, to)) return { ...base, mode: 'wrap' }
  if (input.failed) return { ...base, mode: 'unavailable' }
  if (input.loading) return { ...base, mode: 'loading' }
  const quoted = input.quote && candidates.find(({ pool }) => pool.protocol === input.quote?.pool.protocol && pool.id.toLowerCase() === input.quote.pool.id.toLowerCase())
  if (quoted && input.quote) return { ...base, mode: 'quote', activePool: input.quote.pool, quotePool: input.quote.pool, zeroForOne: input.quote.zeroForOne }
  const first = candidates[0]
  return first ? { ...base, mode: 'pair', activePool: first.pool, zeroForOne: first.zeroForOne } : { ...base, mode: 'empty' }
}
