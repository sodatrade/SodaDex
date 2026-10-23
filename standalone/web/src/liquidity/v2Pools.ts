import { getAddress, zeroAddress, type Address } from 'viem'
import { V2, V2_FACTORY, V2_PAIR, V2_ROUTER_READ, v2StandardAssets } from '../../../v2-protocol'
import { hexQuantity, rpc } from '../lib/rpc'
import { validateCurrency, positionCurrency } from './currencies'
import { protocolCurrency } from './config'
import { call } from './rpc'
import { LiquidityError, type Currency, type PublicRpc } from './types'
import type { V2Pool, V2Position } from './v2Types'
import { v2Supply } from './v2Math'

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
export async function discoverV2(currencyA: Currency, currencyB: Currency, read: PublicRpc = rpc): Promise<V2Pool> {
  if (!v2StandardAssets(currencyA.address, currencyB.address)) throw new LiquidityError('invalidCurrency')
  if (hexQuantity(await read('eth_chainId')) !== 196n) throw new LiquidityError('invalidPool')
  const a = protocolCurrency(validateCurrency(currencyA), 'v3'), b = protocolCurrency(validateCurrency(currencyB), 'v3')
  if (same(a.address, b.address) || a.address === zeroAddress || b.address === zeroAddress) throw new LiquidityError('invalidCurrency')
  const [currency0, currency1] = BigInt(a.address) < BigInt(b.address) ? [a, b] : [b, a]
  const block = String(await read('eth_blockNumber'))
  const [factory, wrapped, pair, feeTo] = await Promise.all([
    call(V2_ROUTER_READ, V2.router, 'factory', [], read, block),
    call(V2_ROUTER_READ, V2.router, 'WETH', [], read, block),
    call(V2_FACTORY, V2.factory, 'getPair', [currency0.address, currency1.address], read, block),
    call(V2_FACTORY, V2.factory, 'feeTo', [], read, block),
  ])
  if (!same(String(factory), V2.factory) || !same(String(wrapped), V2.wrapped)) throw new LiquidityError('invalidPool')
  const address = getAddress(pair as Address)
  const base: V2Pool = { protocol: 'v2', id: address, currency0, currency1, fee: V2.fee,
    reserve0: 0n, reserve1: 0n, totalSupply: 0n, kLast: 0n, feeOn: feeTo !== zeroAddress, initialized: false }
  if (address === zeroAddress) return base
  const [pairFactory, token0, token1, reserves, totalSupply, kLast] = await Promise.all([
    call(V2_PAIR, address, 'factory', [], read, block), call(V2_PAIR, address, 'token0', [], read, block),
    call(V2_PAIR, address, 'token1', [], read, block), call(V2_PAIR, address, 'getReserves', [], read, block),
    call(V2_PAIR, address, 'totalSupply', [], read, block), call(V2_PAIR, address, 'kLast', [], read, block),
  ])
  if (!same(String(pairFactory), V2.factory) || !same(String(token0), currency0.address) || !same(String(token1), currency1.address))
    throw new LiquidityError('invalidPool')
  const [reserve0, reserve1] = reserves as readonly [bigint, bigint]
  return { ...base, address, reserve0, reserve1, totalSupply: totalSupply as bigint, kLast: kLast as bigint,
    initialized: reserve0 > 0n && reserve1 > 0n }
}
export async function getV2Position(pool: V2Pool, owner: Address, read: PublicRpc = rpc): Promise<V2Position> {
  const current = await discoverV2(pool.currency0, pool.currency1, read)
  if (!same(current.id, pool.id)) throw new LiquidityError('poolChanged')
  const balance = current.address ? await call(V2_PAIR, current.address, 'balanceOf', [owner], read) as bigint : 0n
  const supply = v2Supply(current.totalSupply, current.reserve0, current.reserve1, current.kLast, current.feeOn)
  return { pool: current, owner, balance, amount0: supply ? balance * current.reserve0 / supply : 0n,
    amount1: supply ? balance * current.reserve1 / supply : 0n }
}
export async function listV2Positions(pools: readonly V2Pool[], owner: Address, read: PublicRpc = rpc): Promise<{ positions: V2Position[]; unavailable: number }> {
  const positions: V2Position[] = []
  let unavailable = 0
  for (let i = 0; i < pools.length; i += 4) {
    const batch = await Promise.allSettled(pools.slice(i, i + 4).map(pool => getV2Position(pool, owner, read)))
    for (const result of batch) {
      if (result.status === 'rejected') unavailable++
      else if (result.value.balance > 0n) positions.push(result.value)
    }
  }
  return { positions, unavailable }
}
/** Explicit-RPC acceptance discovery. Browser lists come from the persistent directory. */
export async function listV2Pools(read: PublicRpc): Promise<V2Pool[]> {
  const count = await call(V2_FACTORY, V2.factory, 'allPairsLength', [], read) as bigint
  if (count > 1000n) throw new LiquidityError('failed')
  const result: V2Pool[] = []
  for (let index = 0n; index < count; index++) {
    const pair = await call(V2_FACTORY, V2.factory, 'allPairs', [index], read) as Address
    const [a, b] = await Promise.all(['token0', 'token1'].map(name => call(V2_PAIR, pair, name, [], read) as Promise<Address>))
    try {
      result.push(await discoverV2(await positionCurrency(a, 'v3', read), await positionCurrency(b, 'v3', read), read))
    } catch { /* Permissionless tokens with unreadable metadata are not usable through this adapter. */ }
  }
  return result
}
