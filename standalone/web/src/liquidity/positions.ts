import { decodeEventLog, isAddress, keccak256, pad, toHex, zeroAddress, type Address } from 'viem'
import { hexQuantity, rpc } from '../lib/rpc'
import { nftAbi, poolAbi, stateAbi, v3ManagerAbi, v4ManagerAbi } from './abis'
import { LP_CONTRACTS } from './config'
import { positionCurrency } from './currencies'
import { deploymentLogs } from './events'
import { feeDelta, positionForLiquidity } from './math'
import { discoverPool } from './pools'
import { call } from './rpc'
import {
  LiquidityError,
  type LiquidityPool,
  type LiquidityPosition,
  type LiquidityProtocol,
  type PublicRpc,
} from './types'
export async function getPosition(
  protocol: LiquidityProtocol,
  tokenId: bigint,
  read: PublicRpc = rpc,
): Promise<LiquidityPosition> {
  if (tokenId < 1n) throw new LiquidityError('invalidAmount')
  const block = toHex(hexQuantity(await read('eth_blockNumber')))
  const upstream = read
  read = async (method, params) =>
    upstream(
      method,
      (method === 'eth_call' || method === 'eth_getCode') && params?.[1] === 'latest' ? [params[0], block] : params,
    )
  const manager = protocol === 'v3' ? LP_CONTRACTS.v3Manager : LP_CONTRACTS.v4Manager
  const owner = (await call(nftAbi, manager, 'ownerOf', [tokenId], read)) as Address
  let pool: LiquidityPool,
    lower: number,
    upper: number,
    liquidity: bigint,
    fees0 = 0n,
    fees1 = 0n,
    claimable0 = 0n,
    claimable1 = 0n
  if (protocol === 'v3') {
    const data = (await call(v3ManagerAbi, manager, 'positions', [tokenId], read)) as readonly [
      bigint,
      Address,
      Address,
      Address,
      number,
      number,
      number,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ]
    const [, , a, b, fee, l, u, liq, last0, last1, owed0, owed1] = data
    pool = await discoverPool(
      {
        protocol,
        currencyA: await positionCurrency(a, protocol, read),
        currencyB: await positionCurrency(b, protocol, read),
        fee,
      },
      read,
    )
    lower = l
    upper = u
    liquidity = liq
    const [global0, global1, low, high] = await Promise.all([
      call(poolAbi, pool.address!, 'feeGrowthGlobal0X128', [], read),
      call(poolAbi, pool.address!, 'feeGrowthGlobal1X128', [], read),
      call(poolAbi, pool.address!, 'ticks', [l], read),
      call(poolAbi, pool.address!, 'ticks', [u], read),
    ])
    const inside = (g: bigint, lo: bigint, hi: bigint): bigint =>
      BigInt.asUintN(
        256,
        g - (pool.tick >= l ? lo : BigInt.asUintN(256, g - lo)) - (pool.tick < u ? hi : BigInt.asUintN(256, g - hi)),
      )
    const lo = low as readonly bigint[],
      hi = high as readonly bigint[]
    fees0 = feeDelta(inside(global0 as bigint, lo[2], hi[2]), last0, liquidity)
    fees1 = feeDelta(inside(global1 as bigint, lo[3], hi[3]), last1, liquidity)
    claimable0 = owed0 + fees0
    claimable1 = owed1 + fees1
  } else {
    const [key, info] = (await call(v4ManagerAbi, manager, 'getPoolAndPositionInfo', [tokenId], read)) as readonly [
      { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address },
      bigint,
    ]
    if (key.hooks !== zeroAddress) throw new LiquidityError('invalidPool')
    pool = await discoverPool(
      {
        protocol,
        currencyA: await positionCurrency(key.currency0, protocol, read),
        currencyB: await positionCurrency(key.currency1, protocol, read),
        fee: key.fee,
        tickSpacing: key.tickSpacing,
      },
      read,
    )
    lower = Number(BigInt.asIntN(24, info >> 8n))
    upper = Number(BigInt.asIntN(24, info >> 32n))
    const [inside, last] = await Promise.all([
      call(stateAbi, LP_CONTRACTS.stateView, 'getFeeGrowthInside', [pool.id, lower, upper], read),
      call(
        stateAbi,
        LP_CONTRACTS.stateView,
        'getPositionInfo',
        [pool.id, manager, lower, upper, pad(toHex(tokenId), { size: 32 })],
        read,
      ),
    ])
    const [current0, current1] = inside as readonly bigint[],
      [liq, last0, last1] = last as readonly bigint[]
    liquidity = liq
    fees0 = feeDelta(current0, last0, liq)
    fees1 = feeDelta(current1, last1, liq)
    claimable0 = fees0
    claimable1 = fees1
  }
  const p = positionForLiquidity(pool, lower, upper, liquidity)
  return {
    protocol,
    tokenId,
    owner,
    pool,
    tickLower: lower,
    tickUpper: upper,
    liquidity,
    amount0: BigInt(p.amount0.quotient.toString()),
    amount1: BigInt(p.amount1.quotient.toString()),
    fees0,
    fees1,
    claimable0,
    claimable1,
    inRange: pool.tick >= lower && pool.tick < upper,
  }
}
/** V4 is not enumerable: scan recipient Transfer topics, then verify current ownership. */
export async function listPositions(owner: Address, read: PublicRpc = rpc): Promise<LiquidityPosition[]> {
  if (!isAddress(owner)) throw new LiquidityError('invalidCurrency')
  const result: LiquidityPosition[] = []
  const count = (await call(v3ManagerAbi, LP_CONTRACTS.v3Manager, 'balanceOf', [owner], read)) as bigint
  for (let i = 0n; i < count; i++)
    result.push(
      await getPosition(
        'v3',
        (await call(v3ManagerAbi, LP_CONTRACTS.v3Manager, 'tokenOfOwnerByIndex', [owner, i], read)) as bigint,
        read,
      ),
    )
  const head = hexQuantity(await read('eth_blockNumber'))
  // Deployment block is retained in the immutable receipt, never inferred from a timestamp.
  const start = 73368428n // v4PositionManager deployment receipt block 0x45f836c
  const topic = keccak256(new TextEncoder().encode('Transfer(address,address,uint256)'))
  const [incoming, outgoing] = await Promise.all([
    deploymentLogs(LP_CONTRACTS.v4Manager, [topic, null, pad(owner, { size: 32 })], start, head, read),
    deploymentLogs(LP_CONTRACTS.v4Manager, [topic, pad(owner, { size: 32 })], start, head, read),
  ])
  const ids = new Set<bigint>()
  const logs = [...incoming, ...outgoing].sort(
    (a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)),
  )
  for (const log of logs) {
    const { args } = decodeEventLog({ abi: nftAbi, data: log.data, topics: log.topics })
    if (args.to.toLowerCase() === owner.toLowerCase()) ids.add(args.tokenId)
    else ids.delete(args.tokenId)
  }
  for (const id of ids) {
    // Verify actual ownership; failed/partial RPC data never masquerades as an empty portfolio.
    const current = await call(nftAbi, LP_CONTRACTS.v4Manager, 'ownerOf', [id], read)
    if (typeof current !== 'string') throw new LiquidityError('failed')
    if (current.toLowerCase() === owner.toLowerCase()) result.push(await getPosition('v4', id, read))
  }
  return result
}
