import { parseAbi, toHex, type Address, type Hex } from 'viem'
import { LiquidityError, type PublicRpc } from './types'
export const createdAbi = parseAbi([
  'event PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)',
])
export const initializedAbi = parseAbi([
  'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)',
])
interface EventLog {
  address: Address
  topics: [Hex, ...Hex[]]
  data: Hex
  blockNumber: Hex
  logIndex: Hex
  removed?: boolean
}
export async function deploymentLogs(
  address: Address,
  topics: unknown[],
  from: bigint,
  head: bigint,
  read: PublicRpc,
): Promise<EventLog[]> {
  const result: EventLog[] = []
  for (let start = from; start <= head; start += 2000n) {
    const end = start + 1999n < head ? start + 1999n : head
    const page = await read('eth_getLogs', [{ address, fromBlock: toHex(start), toBlock: toHex(end), topics }])
    if (!Array.isArray(page)) throw new LiquidityError('failed')
    for (const entry of page) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        entry.address?.toLowerCase() !== address.toLowerCase() ||
        !Array.isArray(entry.topics) ||
        typeof entry.data !== 'string' ||
        typeof entry.blockNumber !== 'string' ||
        typeof entry.logIndex !== 'string'
      )
        throw new LiquidityError('failed')
      if (!entry.removed) result.push(entry as EventLog)
    }
  }
  return result
}
