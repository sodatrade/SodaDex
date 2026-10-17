import { WOKB_ADDRESS, type Protocol } from '../../domain/assets'
import type { Currency, LiquidityPool } from '../../liquidity/types'
import { sameCurrency } from '../swap/routes'
export function orderPools(pools: LiquidityPool[], from: Currency, to: Currency, protocol: Protocol): LiquidityPool[] {
  if (from.native || sameCurrency(from, to)) return []
  return pools.flatMap((p) => {
    if (!p.initialized || (protocol !== 'auto' && p.protocol !== protocol)) return []
    const address = (c: Currency): string => c.native && p.protocol === 'v3' ? WOKB_ADDRESS.toLowerCase() : c.address.toLowerCase()
    const direct = address(from) === p.currency0.address.toLowerCase() && address(to) === p.currency1.address.toLowerCase()
    const reverse = address(from) === p.currency1.address.toLowerCase() && address(to) === p.currency0.address.toLowerCase()
    if (!direct && !reverse) return []
    return [{ ...p, currency0: { ...(direct ? from : to), address: p.currency0.address }, currency1: { ...(direct ? to : from), address: p.currency1.address } }]
  })
}
