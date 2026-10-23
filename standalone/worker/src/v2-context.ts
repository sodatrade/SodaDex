import { V2, V2_FACTORY, V2_PAIR, V2_ROUTER_READ, v2StandardAssets } from '../../v2-protocol'
import { same, ZERO } from './contracts'
import { call } from './upstream'
import type { V2Request } from './v2-requests'

export async function registeredV2Pair(address: string, at: string, upstream: typeof fetch): Promise<boolean> {
  const [factory, token0, token1] = await Promise.all(['factory', 'token0', 'token1'].map(name => call(V2_PAIR, address, name, [], at, upstream)))
  if (typeof factory !== 'string' || !same(factory, V2.factory) || typeof token0 !== 'string' || typeof token1 !== 'string') return false
  const pair = await call(V2_FACTORY, V2.factory, 'getPair', [token0, token1], at, upstream)
  return typeof pair === 'string' && !same(pair, ZERO) && same(pair, address)
}
export async function validV2Context(route: V2Request, owner: string, at: string, upstream: typeof fetch): Promise<boolean> {
  if (!v2StandardAssets(route.token0, route.token1)) return false
  const [factory, wrapped, pair] = await Promise.all([
    call(V2_ROUTER_READ, V2.router, 'factory', [], at, upstream), call(V2_ROUTER_READ, V2.router, 'WETH', [], at, upstream),
    call(V2_FACTORY, V2.factory, 'getPair', [route.token0, route.token1], at, upstream),
  ])
  if (typeof factory !== 'string' || !same(factory, V2.factory) || typeof wrapped !== 'string' || !same(wrapped, V2.wrapped) || typeof pair !== 'string') return false
  if (same(pair, ZERO)) return route.kind === 'add'
  if (!await registeredV2Pair(pair, at, upstream)) return false
  if (route.kind === 'remove') {
    const balance = await call(V2_PAIR, pair, 'balanceOf', [owner], at, upstream)
    if (typeof balance !== 'bigint' || balance < route.liquidity!) return false
  }
  if (route.kind === 'swap') {
    const reserves = await call(V2_PAIR, pair, 'getReserves', [], at, upstream)
    if (!Array.isArray(reserves) || reserves[0] <= 0n || reserves[1] <= 0n) return false
  }
  return true
}
