import { vi } from 'vitest'
import { decodeFunctionData, encodeFunctionResult, type Abi, type Hex } from 'viem'
import { ERC20_READ, FACTORY_READ, STATE_READ, V3_POOL_READ, ZERO } from '../src/contracts'
import { poolId } from '../src/dex-data'
import { reference, V2_FACTORY, V2_PAIR } from '../src/reference-config'
import { V3_QUOTE_READ, V4_QUOTE_READ } from '../src/quote-requests'
export const tokenA = '0x1111111111111111111111111111111111111111'
export const tokenB = '0x2222222222222222222222222222222222222222'
export const pair2 = '0x3333333333333333333333333333333333333333'
export const pool3 = '0x4444444444444444444444444444444444444444'
export const block = { number: '0x123456', hash: `0x${'a'.repeat(64)}`, timestamp: '0x68000000' }
export interface FixtureOptions { empty?: boolean; wrongChain?: boolean; failV3?: boolean; failDecimals?: boolean; allPools?: boolean }
export function referenceFixture(options: FixtureOptions = {}): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] }
    let result: unknown
    if (body.method === 'eth_chainId') result = options.wrongChain ? '0x1' : '0xc4'
    else if (body.method === 'eth_getBlockByNumber') result = block
    else if (body.method === 'eth_call') {
      const tx = body.params[0] as { to: string; data: Hex }
      const to = tx.to.toLowerCase()
      let abi: Abi = ERC20_READ
      if (to === reference.contracts.v2Factory.toLowerCase()) abi = V2_FACTORY
      else if (to === reference.contracts.v3Factory.toLowerCase()) {
        if (options.failV3) return new Response(null, { status: 503 })
        abi = FACTORY_READ
      }
      else if (to === reference.contracts.v4StateView.toLowerCase()) abi = STATE_READ
      else if (to === pair2) abi = V2_PAIR
      else if (to === pool3) abi = V3_POOL_READ
      else if (to === reference.contracts.v3Quoter.toLowerCase()) abi = V3_QUOTE_READ
      else if (to === reference.contracts.v4Quoter.toLowerCase()) abi = V4_QUOTE_READ
      const decoded = decodeFunctionData({ abi, data: tx.data })
      if (decoded.functionName === 'decimals' && options.failDecimals) return new Response(null, { status: 503 })
      const args = decoded.args ?? []
      const v4Known = String(args[0]) === poolId(tokenA, tokenB, 500, 10, ZERO) || String(args[0]) === poolId(ZERO, tokenA, 500, 10, ZERO)
      const values: Record<string, unknown> = {
        name: 'Actual chain token', symbol: 'CHAIN', decimals: 6, balanceOf: 100n,
        getPair: options.empty ? ZERO : pair2, getPool: options.empty || (!options.allPools && args[2] !== 500) ? ZERO : pool3,
        getReserves: [1000n, 2000n, 1], totalSupply: 999n,
        slot0: [2n ** 96n, 0, 0, 1, 1, 0, true], liquidity: 400n, tickSpacing: 10,
        getSlot0: [!options.empty && (v4Known || options.allPools) ? 2n ** 96n : 0n, 0, 0, 500], getLiquidity: 500n,
        quoteExactInputSingle: to === reference.contracts.v3Quoter.toLowerCase() ? [1000n, 2n ** 96n, 1, 200_000n] : [900n, 100_000n],
      }
      result = encodeFunctionResult({ abi, functionName: decoded.functionName, result: values[decoded.functionName] })
    } else throw new Error(`Unexpected method ${body.method}`)
    return Response.json({ jsonrpc: '2.0', id: body.id, result })
  })
}
export const request = (path: string): Request => new Request(`https://soda.example/api/reference/${path}`)
