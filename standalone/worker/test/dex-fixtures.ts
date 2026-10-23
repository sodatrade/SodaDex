import { vi } from 'vitest'
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, parseAbiParameters, toEventSelector, type Abi, type Hex } from 'viem'
import { deployment, ERC20_READ, EVENTS, FIRST_BLOCK, pools, STATE_READ, V3_POOL_READ } from '../src/contracts'
import type { CursorStore } from '../src/cursors'
export const hash = (character: string): Hex => `0x${character.repeat(64)}`
export const at = FIRST_BLOCK + 5000
export const hex = (n: number): Hex => `0x${n.toString(16)}`
export function swap(index = 0, blockHash = hash('a')): object {
  return { address: pools.v3.address, blockNumber: hex(FIRST_BLOCK + 5), blockHash, transactionHash: hash('b'), logIndex: hex(index), topics: [toEventSelector(EVENTS[2]), `0x${deployment.owner.slice(2).padStart(64, '0')}`, `0x${deployment.owner.slice(2).padStart(64, '0')}`], data: encodeAbiParameters(parseAbiParameters('int256,int256,uint160,uint128,int24'), [10000n, -20n, 2n ** 96n, 10n, 0]), removed: false }
}
export function fixture(items: object[] = [], chainHash = hash('c'), currentBlock = at): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    const body = JSON.parse(String(options?.body)) as { id: number; method: string; params: unknown[] }
    let result: unknown
    if (body.method === 'eth_getBlockByNumber') result = { number: body.params[0] === 'latest' ? hex(currentBlock) : body.params[0], hash: chainHash, timestamp: '0x68000000' }
    else if (body.method === 'eth_getLogs') {
      const filter = body.params[0] as { address: string | string[]; fromBlock: Hex; toBlock: Hex; topics: (Hex | Hex[] | null)[] }
      const addresses = Array.isArray(filter.address) ? filter.address : [filter.address]
      result = items.filter((raw) => {
        const item = raw as { address: string; blockNumber: Hex; topics: Hex[] }
        return addresses.some((address) => address.toLowerCase() === item.address.toLowerCase()) && BigInt(item.blockNumber) >= BigInt(filter.fromBlock) && BigInt(item.blockNumber) <= BigInt(filter.toBlock) && filter.topics.every((topic, index) => topic === null || (Array.isArray(topic) ? topic : [topic]).some((value) => value.toLowerCase() === item.topics[index]?.toLowerCase()))
      })
    }
    else if (body.method === 'eth_getTransactionByHash') result = { hash: body.params[0], from: deployment.owner, blockHash: (items.find((item) => (item as {transactionHash: unknown}).transactionHash === body.params[0]) as {blockHash: string} | undefined)?.blockHash ?? hash('a') }
    else if (body.method === 'eth_call') {
      const request = body.params[0] as { to: string; data: Hex }
      let abi: Abi = ERC20_READ
      if (request.to.toLowerCase() === pools.v3.address.toLowerCase() || ['0x3850c7bd', '0x1a686502'].includes(request.data.slice(0,10))) abi = V3_POOL_READ
      if (request.to.toLowerCase() === deployment.contracts.v4StateView.toLowerCase()) abi = STATE_READ
      const decoded = decodeFunctionData({ abi, data: request.data })
      const values: Record<string, unknown> = { name: 'Token', symbol: 'TOK', decimals: 6, balanceOf: 50n, liquidity: 25n, getLiquidity: 25n, slot0: [2n ** 96n, 0, 0, 0, 0, 0, true], getSlot0: [2n ** 96n, 0, 0, 0] }
      result = encodeFunctionResult({ abi, functionName: decoded.functionName, result: values[decoded.functionName] })
    } else throw new Error(`Unexpected ${body.method}`)
    return Response.json({ jsonrpc: '2.0', id: body.id, result })
  })
}
export function memoryStore(): CursorStore {
  const data = new Map<string, object>()
  return { async get(id) { return data.has(id) ? structuredClone(data.get(id)) : null }, async put(value) { const id = crypto.randomUUID(); data.set(id, structuredClone(value)); return id } }
}
export const request = (path: string): Request => new Request(`https://soda.example/api/dex/${path}`)
