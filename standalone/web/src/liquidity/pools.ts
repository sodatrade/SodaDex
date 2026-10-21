import { discoverV2, listV2Pools } from './v2Pools'
import type { AnyPool, V2Pool } from './v2Types'
import { decodeEventLog, encodeAbiParameters, keccak256, zeroAddress, type Address, type Hex } from 'viem'
import pools from '../../../../deployments/xlayer-test/pools.json'
import { hexQuantity, rpc } from '../lib/rpc'
import { factoryAbi, keyType, poolAbi, stateAbi } from './abis'
import { LP_CONTRACTS, NATIVE_CURRENCY, protocolCurrency } from './config'
import { importCurrency, positionCurrency, validateCurrency } from './currencies'
import { createdAbi, initializedAbi, deploymentLogs } from './events'
import { call } from './rpc'
import { LiquidityError, type LiquidityPool, type PoolDraft, type PublicRpc } from './types'
import { getPools } from '../data/dex'
export const poolKey = (p: Pick<LiquidityPool, 'currency0' | 'currency1' | 'fee' | 'tickSpacing'>) => ({
  currency0: p.currency0.address,
  currency1: p.currency1.address,
  fee: p.fee,
  tickSpacing: p.tickSpacing,
  hooks: zeroAddress,
})
export const poolId = (p: Pick<LiquidityPool, 'currency0' | 'currency1' | 'fee' | 'tickSpacing'>): Hex =>
  keccak256(encodeAbiParameters([keyType], [poolKey(p)]))
export async function discoverPool(draft: PoolDraft, read: PublicRpc = rpc): Promise<LiquidityPool> {
  if (draft.protocol !== 'v3' && draft.protocol !== 'v4') throw new LiquidityError('invalidPool')
  const a = protocolCurrency(validateCurrency(draft.currencyA), draft.protocol),
    b = protocolCurrency(validateCurrency(draft.currencyB), draft.protocol)
  if (
    a.address.toLowerCase() === b.address.toLowerCase() ||
    !Number.isInteger(draft.fee) ||
    draft.fee < 0 ||
    draft.fee >= 1000000
  )
    throw new LiquidityError('invalidPool')
  if (draft.protocol === 'v4' && ((a.native && a.address !== zeroAddress) || (b.native && b.address !== zeroAddress)))
    throw new LiquidityError('invalidCurrency')
  const [currency0, currency1] = BigInt(a.address) < BigInt(b.address) ? [a, b] : [b, a]
  if (draft.protocol === 'v3' && (currency0.address === zeroAddress || ![100, 500, 3000, 10000].includes(draft.fee)))
    throw new LiquidityError('invalidPool')
  let tickSpacing = draft.tickSpacing ?? 1
  if (draft.protocol === 'v3')
    tickSpacing = Number(await call(factoryAbi, LP_CONTRACTS.factory, 'feeAmountTickSpacing', [draft.fee], read))
  if (!Number.isInteger(tickSpacing) || tickSpacing < 1 || tickSpacing > 32767) throw new LiquidityError('invalidPool')
  const base = {
    protocol: draft.protocol,
    currency0,
    currency1,
    fee: draft.fee,
    tickSpacing,
    sqrtPriceX96: 0n,
    tick: 0,
    liquidity: 0n,
    initialized: false,
  }
  if (draft.protocol === 'v3') {
    const address = (await call(
      factoryAbi,
      LP_CONTRACTS.factory,
      'getPool',
      [currency0.address, currency1.address, draft.fee],
      read,
    )) as Address
    if (address === zeroAddress) return { ...base, id: zeroAddress }
    const [slot, liquidity] = await Promise.all([
      call(poolAbi, address, 'slot0', [], read),
      call(poolAbi, address, 'liquidity', [], read),
    ])
    const [sqrtPriceX96, tick] = slot as readonly [bigint, number]
    return {
      ...base,
      address,
      id: address,
      sqrtPriceX96,
      tick,
      liquidity: liquidity as bigint,
      initialized: sqrtPriceX96 > 0n,
    }
  }
  const id = poolId(base)
  const [slot, liquidity] = await Promise.all([
    call(stateAbi, LP_CONTRACTS.stateView, 'getSlot0', [id], read),
    call(stateAbi, LP_CONTRACTS.stateView, 'getLiquidity', [id], read),
  ])
  const [sqrtPriceX96, tick] = slot as readonly [bigint, number]
  return { ...base, id, sqrtPriceX96, tick, liquidity: liquidity as bigint, initialized: sqrtPriceX96 > 0n }
}
export function refreshPool(pool: LiquidityPool, read: PublicRpc): Promise<LiquidityPool>
export function refreshPool(pool: V2Pool, read: PublicRpc): Promise<V2Pool>
export function refreshPool(pool: AnyPool, read: PublicRpc): Promise<AnyPool>
export async function refreshPool(pool: AnyPool, read: PublicRpc): Promise<AnyPool> {
  if (pool.protocol === 'v2') return discoverV2(pool.currency0, pool.currency1, read)
  return discoverPool(
    {
      protocol: pool.protocol,
      currencyA: pool.currency0,
      currencyB: pool.currency1,
      fee: pool.fee,
      tickSpacing: pool.tickSpacing,
    },
    read,
  )
}
/** Seed pools plus hookless deployment events whose assets and current state can be read. */
export async function listPools(read: PublicRpc = rpc): Promise<LiquidityPool[]> {
  // Browser discovery reads the shared persistent directory. Explicit RPC adapters
  // retain direct discovery for isolated forks and protocol acceptance tests.
  if (read === rpc) return (await indexedPools(read)).filter((pool): pool is LiquidityPool => pool.protocol !== 'v2')
  const stable = await importCurrency(pools.stable.address, read)
  const result = await Promise.all([
    discoverPool({ protocol: 'v3', currencyA: NATIVE_CURRENCY, currencyB: stable, fee: pools.v3.fee }, read),
    discoverPool(
      {
        protocol: 'v4',
        currencyA: NATIVE_CURRENCY,
        currencyB: stable,
        fee: pools.v4.fee,
        tickSpacing: pools.v4.tickSpacing,
      },
      read,
    ),
  ])
  const head = hexQuantity(await read('eth_blockNumber'))
  const v3Topic = keccak256(new TextEncoder().encode('PoolCreated(address,address,uint24,int24,address)'))
  const v4Topic = keccak256(
    new TextEncoder().encode('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)'),
  )
  const [created, initialized] = await Promise.all([
    deploymentLogs(LP_CONTRACTS.factory, [v3Topic], 73361037n, head, read),
    deploymentLogs(LP_CONTRACTS.poolManager, [v4Topic], 73361037n, head, read),
  ])
  for (const log of created) {
    const { args } = decodeEventLog({ abi: createdAbi, data: log.data, topics: log.topics })
    if (result.some((p) => p.protocol === 'v3' && p.id.toLowerCase() === args.pool.toLowerCase())) continue
    try {
      const a = await positionCurrency(args.token0, 'v3', read),
        b = await positionCurrency(args.token1, 'v3', read)
      result.push(await discoverPool({ protocol: 'v3', currencyA: a, currencyB: b, fee: args.fee }, read))
    } catch {
      /* A permissionless pool may reference an EOA or unsupported metadata. Keep readable pools. */
    }
  }
  for (const log of initialized) {
    const { args } = decodeEventLog({ abi: initializedAbi, data: log.data, topics: log.topics })
    if (
      args.hooks !== zeroAddress ||
      result.some((p) => p.protocol === 'v4' && p.id.toLowerCase() === args.id.toLowerCase())
    )
      continue
    try {
      result.push(
        await discoverPool(
          {
            protocol: 'v4',
            currencyA: await importCurrency(args.currency0, read),
            currencyB: await importCurrency(args.currency1, read),
            fee: args.fee,
            tickSpacing: args.tickSpacing,
          },
          read,
        ),
      )
    } catch {
      /* A single unreadable asset must not hide all other pools. */
    }
  }
  return result
}

async function indexedPools(read: PublicRpc): Promise<AnyPool[]> {
  const catalog = await getPools(), result: AnyPool[] = []
  // Bound concurrent metadata/state reads as permissionless pool counts grow.
  for (let offset = 0; offset < catalog.pools.length; offset += 4) {
    const batch = await Promise.all(catalog.pools.slice(offset, offset + 4).map(async (pool) => {
      if (pool.hooks.toLowerCase() !== zeroAddress) return null
      try {
        const [currencyA, currencyB] = await Promise.all([
          positionCurrency(pool.token0 as Address, pool.protocol === 'v2' ? 'v3' : pool.protocol, read),
          positionCurrency(pool.token1 as Address, pool.protocol === 'v2' ? 'v3' : pool.protocol, read),
        ])
        const current = pool.protocol === 'v2' ? await discoverV2(currencyA, currencyB, read) : await discoverPool({ protocol: pool.protocol, currencyA, currencyB, fee: pool.fee, tickSpacing: pool.tickSpacing }, read)
        // A directory supplies candidates, never authority over a pool identity.
        return current.id.toLowerCase() === pool.id.toLowerCase() && current.initialized ? current : null
      } catch { return null }
    }))
    for (const pool of batch) if (pool) result.push(pool)
  }
  if (catalog.pools.length && !result.length) throw new LiquidityError('failed')
  return result
}

export async function listAllPools(read: PublicRpc = rpc): Promise<AnyPool[]> {
  return read === rpc ? indexedPools(read) : [...await listPools(read), ...await listV2Pools(read)]
}
