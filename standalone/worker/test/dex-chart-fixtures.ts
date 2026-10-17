import { vi } from 'vitest'
import { encodeAbiParameters, parseAbiParameters, toEventSelector, type Hex } from 'viem'
import { deployment, EVENTS, FIRST_BLOCK, pools } from '../src/contracts'
import { fixture, hex } from './dex-fixtures'
export const BASE_TIME = 1_700_000_000
export const Q96 = 2n ** 96n
export function chartHash(number: number, salt = 0): Hex { return `0x${(BigInt(number) + BigInt(salt) * 2n ** 128n).toString(16).padStart(64, '0')}` }
export function chartSwap(number: number, index = 0, price = Q96, v4 = false): object {
  return { address: v4 ? deployment.contracts.v4PoolManager : pools.v3.address, blockNumber: hex(number), blockHash: chartHash(number), transactionHash: chartHash(number * 1000 + index), logIndex: hex(index), topics: v4 ? [toEventSelector(EVENTS[3]), pools.v4.poolId, `0x${deployment.owner.slice(2).padStart(64, '0')}`] : [toEventSelector(EVENTS[2]), `0x${deployment.owner.slice(2).padStart(64, '0')}`, `0x${deployment.owner.slice(2).padStart(64, '0')}`], data: v4 ? encodeAbiParameters(parseAbiParameters('int128,int128,uint160,uint128,int24,uint24'), [-10000n, 20n, price, 10n, 0, 0]) : encodeAbiParameters(parseAbiParameters('int256,int256,uint160,uint128,int24'), [10000n, -20n, price, 10n, 0]), removed: false }
}
export interface ChartFixtureOptions { currentBlock?: number; chainSalt?: { value: number }; missingDecimals?: boolean; failedLogs?: boolean; wrongBlockHash?: number; invalidTimestamp?: number }
export function chartFixture(items: object[] = [], options: ChartFixtureOptions = {}): ReturnType<typeof vi.fn<typeof fetch>> {
  const current = options.currentBlock ?? FIRST_BLOCK + 5000
  const delegate = fixture(items, chartHash(current), current)
  return vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] }
    if (body.method === 'eth_getBlockByNumber') {
      const number = body.params[0] === 'latest' ? current : Number(BigInt(String(body.params[0])))
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { number: hex(number), hash: chartHash(number, options.wrongBlockHash === number ? 99 : options.chainSalt?.value ?? 0), timestamp: options.invalidTimestamp === number ? '0xffffffffffffffffffff' : hex(BASE_TIME + number - FIRST_BLOCK) } })
    }
    if (body.method === 'eth_getLogs' && options.failedLogs) return new Response('down', { status: 503 })
    if (body.method === 'eth_call' && options.missingDecimals && (body.params[0] as { data: string }).data === '0x313ce567') return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'decimals unavailable' } })
    return delegate(input, init)
  })
}
export const chartPath = (extra = ''): string => `chart?pool=${pools.v3.address}&interval=1h${extra}`
