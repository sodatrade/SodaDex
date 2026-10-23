import { describe, expect, it } from 'vitest'
import { decodeFunctionData, encodeFunctionResult, zeroAddress, type Abi } from 'viem'
import { V2, V2_FACTORY, V2_PAIR, V2_ROUTER_READ } from '../../v2-protocol'
import { ERC20_READ } from '../src/contracts'
import { knownPools } from '../src/dex-data'
import { market, resolvePool } from '../src/dex-market'
import { registeredV2Pair, validV2Context } from '../src/v2-context'
const pair = `0x${'11'.repeat(20)}`, a = `0x${'22'.repeat(20)}`, b = `0x${'33'.repeat(20)}`
const block = { number: 100, hash: `0x${'44'.repeat(32)}`, timestamp: 1000 }
const range = { fromBlock: 100, toBlock: 100, complete: true, nextFromBlock: null }
function fixture(overrides: Record<string, unknown> = {}) {
  const tags: unknown[] = [], calls: string[] = []
  const upstream: typeof fetch = async (_url, options) => {
    const req = JSON.parse(String(options?.body))
    if (req.method === 'eth_getLogs') return Response.json({ jsonrpc: '2.0', id: req.id, result: [] })
    if (req.method !== 'eth_call') throw Error('Unexpected request')
    const tx = req.params[0], to = tx.to.toLowerCase()
    const abi: Abi = to === pair ? V2_PAIR : to === V2.router.toLowerCase() ? V2_ROUTER_READ : to === V2.factory.toLowerCase() ? V2_FACTORY : ERC20_READ
    const { functionName } = decodeFunctionData({ abi, data: tx.data })
    tags.push(req.params[1]); calls.push(functionName)
    const values: Record<string, unknown> = { factory: V2.factory, WETH: V2.wrapped, token0: a, token1: b,
      getPair: pair, getReserves: [100n, 200n, 1000], balanceOf: to === pair ? 100n : to === a ? 100n : 900n,
      decimals: 18, symbol: 'TEST', name: 'Test asset', ...overrides }
    const value = values[functionName]
    if (value instanceof Error) throw value
    return Response.json({ jsonrpc: '2.0', id: req.id, result: encodeFunctionResult({ abi, functionName, result: value }) })
  }
  return { upstream, tags, calls }
}
describe('V2 contract context', () => {
  it('rejects known taxed assets before simulation of standard Router02 actions', async () => {
    const f = fixture(), taxed = '0xc9e6CFEFB3433B1b46d3FA61E096ABB519fFE7E0'
    for (const kind of ['add', 'swap', 'remove'] as const)
      expect(await validV2Context({ kind, token0: a, token1: taxed, liquidity: 1n }, a, 'latest', f.upstream)).toBe(false)
    expect(f.calls).toEqual([])
  })
  it('binds router, factory and pair at the requested block before permitting a swap', async () => {
    const f = fixture()
    expect(await validV2Context({ kind: 'swap', token0: a, token1: b }, a, '0x64', f.upstream)).toBe(true)
    expect(new Set(f.tags)).toEqual(new Set(['0x64']))
    for (const overrides of [{ factory: a }, { WETH: a }, { getReserves: [0n, 200n, 1000] }])
      expect(await validV2Context({ kind: 'swap', token0: a, token1: b }, a, '0x64', fixture(overrides).upstream)).toBe(false)
    expect(await registeredV2Pair(pair, '0x64', fixture({ getPair: a }).upstream)).toBe(false)
  })
  it('allows only an add for an absent pair and rejects excess LP removal', async () => {
    for (const kind of ['add', 'remove', 'swap'] as const)
      expect(await validV2Context({ kind, token0: a, token1: b, liquidity: 1n }, a, '0x64', fixture({ getPair: zeroAddress }).upstream)).toBe(kind === 'add')
    expect(await validV2Context({ kind: 'remove', token0: a, token1: b, liquidity: 101n }, a, '0x64', fixture().upstream)).toBe(false)
    expect(await validV2Context({ kind: 'remove', token0: a, token1: b, liquidity: 100n }, a, '0x64', fixture().upstream)).toBe(true)
  })
})
describe('V2 market consistency', () => {
  it('uses stored reserves rather than unsynced donations or token balance failures', async () => {
    for (const overrides of [{}, { balanceOf: new Error('balance unavailable') }]) {
      const f = fixture(overrides)
      const result = await market(new URL(`https://example.test/api/dex/market?pool=${pair}&protocol=v2`), block, range, f.upstream) as {
        reserves: { token0Raw: string; token1Raw: string }; priceToken1PerToken0: string
      }
      expect(result.reserves).toMatchObject({ token0Raw: '100', token1Raw: '200' })
      expect(Number(result.priceToken1PerToken0)).toBeCloseTo(2, 12)
      expect(f.calls).not.toContain('balanceOf')
      expect(new Set(f.tags)).toEqual(new Set(['0x64']))
    }
  })
  it('rejects an explicit protocol that does not match the supplied pool', async () => {
    const known = knownPools().find(p => p.protocol === 'v3')!
    for (const url of [`?pool=${known.id}&protocol=v2`, `?pool=${pair}&protocol=v4`, `?pool=${pair}&protocol=invalid`])
      await expect(resolvePool(new URL(`https://example.test/${url}`), block, fixture().upstream)).rejects.toThrow()
  })
})
