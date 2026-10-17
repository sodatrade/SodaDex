import { describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, encodeFunctionData, parseAbi, type Hex } from 'viem'
import { deployment, ZERO } from '../src/contracts'
import { referenceApi } from '../src/reference-api'
import { reference } from '../src/reference-config'
import type { ReferencePoolsResponse, ReferenceQuoteResponse, ReferenceTokensResponse } from '../src/reference-types'
import { V3_QUOTE_READ, V4_QUOTE_READ } from '../src/quote-requests'
import { validContractRequest } from '../src/trade-requests'
import { block, pool3, referenceFixture, request, tokenA, tokenB } from './reference-fixtures'
const pairQuery = `token0=${tokenA}&token1=${tokenB}`
describe('official X Layer reference API is read-only', () => {
  it('serves the exact sourced 10-token static directory without RPC access', async () => {
    const upstream = vi.fn<typeof fetch>()
    const response = await referenceApi(request('tokens'), upstream)
    const data = await response.json() as ReferenceTokensResponse
    expect(data).toMatchObject({ schemaVersion: 1, chainId: 196, source: 'uniswap', readOnly: true })
    expect(data.tokens).toHaveLength(10)
    expect(new Set(data.tokens.map((token) => token.address.toLowerCase())).size).toBe(10)
    expect(data.tokens.every((token) => token.metadataSource === 'okx-tokenlist' && token.metadataError === null && token.logoURI?.startsWith('https://'))).toBe(true)
    expect(data.tokenList.source).toBe('https://raw.githubusercontent.com/okx/xlayer-tokenlist/main/xlayer.tokenlist.json')
    expect(data.tokenList.contentSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(upstream).not.toHaveBeenCalled()
  })
  it('discovers only exact selected-pair candidate pools and pins all reads to one block', async () => {
    const upstream = referenceFixture()
    const response = await referenceApi(request(`pools?${pairQuery}`), upstream)
    const data = await response.json() as ReferencePoolsResponse
    expect(response.status).toBe(200)
    expect(data.pools.map((pool) => pool.protocol)).toEqual(['v2', 'v3', 'v4'])
    expect(data.asOf).toEqual({ number: Number(BigInt(block.number)), hash: block.hash, timestamp: Number(BigInt(block.timestamp)) })
    expect(data.discovery).toMatchObject({ kind: 'pair-candidates', complete: false, v3Fees: [100, 500, 3000, 10000] })
    expect(data.errors).toEqual([])
    expect(data.pools[0]).toMatchObject({ fee: 3000, liquidity: '999', reserves: { token0Raw: '1000', token1Raw: '2000' }, priceToken1PerToken0: '2' })
    expect(data.pools[1]).toMatchObject({ id: pool3, fee: 500, tickSpacing: 10, reserves: { token0Raw: '100', token1Raw: '100' }, priceToken1PerToken0: '1' })
    expect(data.pools[2]).toMatchObject({ address: null, liquidity: '500', reserves: { token0Raw: null, token1Raw: null }, priceToken1PerToken0: '1' })
    expect(data.pools.every((pool) => pool.readOnly && pool.source === 'uniswap' && pool.token0.name === 'Actual chain token' && pool.token0.metadataSource === 'chain')).toBe(true)
    const calls = upstream.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { method: string; params: unknown[] })
    expect(calls.filter((call) => call.method === 'eth_call').every((call) => call.params[1] === block.number)).toBe(true)
    expect(calls.length).toBeLessThan(50)
    expect(new Set(calls.map((call) => call.method))).toEqual(new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_call']))
  })
  it('distinguishes absent pools, per-protocol failures and unavailable metadata from zero metrics', async () => {
    const absent = await (await referenceApi(request(`pools?${pairQuery}`), referenceFixture({ empty: true }))).json() as ReferencePoolsResponse
    expect(absent.pools).toEqual([]); expect(absent.errors).toEqual([]); expect(absent.discovery.complete).toBe(false)
    const partial = await (await referenceApi(request(`pools?${pairQuery}`), referenceFixture({ failV3: true, failDecimals: true }))).json() as ReferencePoolsResponse
    expect(partial.errors).toHaveLength(4)
    expect(partial.errors.every((error) => error.protocol === 'v3')).toBe(true)
    expect(partial.pools).toHaveLength(2)
    expect(partial.pools.every((pool) => pool.priceToken1PerToken0 === null && pool.token0.decimals === null && pool.token0.metadataError !== null)).toBe(true)
  })
  it('keeps the worst candidate set below the Worker subrequest limit and preserves real native versus WOKB identities', async () => {
    const upstream = referenceFixture({ allPools: true })
    const data = await (await referenceApi(request(`pools?${pairQuery}`), upstream)).json() as ReferencePoolsResponse
    expect(data.pools).toHaveLength(9)
    expect(upstream.mock.calls.length).toBeLessThan(50)
    const native = await (await referenceApi(request(`pools?token0=${ZERO}&token1=${tokenA}`), referenceFixture())).json() as ReferencePoolsResponse
    expect(native.pools.find((pool) => pool.protocol === 'v3')?.token1.address).toBe(reference.wrappedNative)
    expect(native.pools.find((pool) => pool.protocol === 'v4')?.token0).toMatchObject({ address: ZERO, symbol: 'OKB', decimals: 18, metadataSource: 'native-chain' })
  })
  it('rejects wrong chain, foreign origin, writes, unknown query parameters and malformed pairs', async () => {
    expect((await referenceApi(request(`pools?${pairQuery}`), referenceFixture({ wrongChain: true }))).status).toBe(502)
    const upstream = vi.fn<typeof fetch>()
    for (const candidate of [new Request('https://soda.example/api/reference/tokens', { method: 'POST' }), new Request('https://soda.example/api/reference/tokens', { headers: { Origin: 'https://evil.example' } }), request('unknown'), request(`pools?token0=bad&token1=${tokenB}`), request(`pools?token0=${tokenA}&token1=${tokenA}`), request(`pools?${pairQuery}&router=${deployment.contracts.universalRouter}`), request(`pools?${pairQuery}&token0=${tokenB}`)]) expect((await referenceApi(candidate, upstream)).status).toBeGreaterThanOrEqual(400)
    expect(upstream).not.toHaveBeenCalled()
  })
  it('never grants official quoters or official Router Permit2 approval through the simulation guard', () => {
    const data = encodeFunctionData({ abi: V3_QUOTE_READ, functionName: 'quoteExactInputSingle', args: [{ tokenIn: tokenA, tokenOut: tokenB, amountIn: 100n, fee: 500, sqrtPriceLimitX96: 0n }] })
    expect(validContractRequest({ to: reference.contracts.v3Quoter, data }, false)).toBe(false)
    const approve = parseAbi(['function approve(address,address,uint160,uint48)'])
    expect(validContractRequest({ from: deployment.owner, to: deployment.permit2, data: encodeFunctionData({ abi: approve, functionName: 'approve', args: [tokenA, '0xDa00aE15d3A71466517129255255db7c0c0956d3', 100n, 2_000_000_000] }) }, true)).toBe(false)
  })
})
describe('reference quotes contain no executable transaction', () => {
  it.each([[tokenA, tokenB, '181'], [tokenB, tokenA, '47']])('uses canonical V2 reserve math in either direction', async (input, output, expected) => {
    const response = await referenceApi(request(`quote?protocol=v2&tokenIn=${input}&tokenOut=${output}&amountInRaw=100`), referenceFixture())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ readOnly: true, protocol: 'v2', amountInRaw: '100', amountOutRaw: expected, gasEstimate: null })
  })
  it.each(['v3', 'v4'])('quotes %s using only its official Quoter after registration/initialization', async (protocol) => {
    const upstream = referenceFixture()
    const response = await referenceApi(request(`quote?protocol=${protocol}&tokenIn=${tokenB}&tokenOut=${tokenA}&amountInRaw=100&fee=500${protocol === 'v4' ? '&tickSpacing=10' : ''}`), upstream)
    const data = await response.json() as ReferenceQuoteResponse
    expect(response.status).toBe(200)
    expect(data).toMatchObject({ readOnly: true, source: 'uniswap', amountOutRaw: protocol === 'v3' ? '1000' : '900' })
    expect(data).not.toHaveProperty('transaction'); expect(data).not.toHaveProperty('data'); expect(data).not.toHaveProperty('spender')
    const calls = upstream.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { method: string; params: { to: string; data: Hex }[] })
    const last = calls.at(-1)!
    expect(last.params[0].to).toBe(protocol === 'v3' ? reference.contracts.v3Quoter : reference.contracts.v4Quoter)
    const decoded = decodeFunctionData({ abi: protocol === 'v3' ? V3_QUOTE_READ : V4_QUOTE_READ, data: last.params[0].data })
    expect(decoded.functionName).toBe('quoteExactInputSingle')
    expect(calls.every((call) => !call.method.includes('send') && call.method !== 'eth_estimateGas')).toBe(true)
  })
  it('returns requested native input and actual pool input distinctly without constructing wrap transactions', async () => {
    for (const protocol of ['v3', 'v4']) {
      const response = await referenceApi(request(`quote?protocol=${protocol}&tokenIn=${ZERO}&tokenOut=${tokenA}&amountInRaw=100&fee=500${protocol === 'v4' ? '&tickSpacing=10' : ''}`), referenceFixture())
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ readOnly: true, tokenIn: ZERO, poolTokenIn: protocol === 'v3' ? reference.wrappedNative : ZERO })
    }
  })
  it('does not invoke a Quoter for missing pools or zero/oversized amount and does not substitute native key metadata', async () => {
    for (const suffix of ['amountInRaw=0', 'amountInRaw=-1', `amountInRaw=${2n ** 128n}`, 'amountInRaw=100&hooks=0x1111111111111111111111111111111111111111']) {
      const upstream = referenceFixture({ empty: true })
      expect((await referenceApi(request(`quote?protocol=v4&tokenIn=${tokenA}&tokenOut=${tokenB}&fee=500&tickSpacing=10&${suffix}`), upstream)).status).toBe(400)
      expect(upstream.mock.calls.every(([, init]) => !String(init?.body).includes(reference.contracts.v4Quoter))).toBe(true)
    }
    const missing = await referenceApi(request(`quote?protocol=v3&tokenIn=${tokenA}&tokenOut=${tokenB}&amountInRaw=100&fee=500`), referenceFixture({ empty: true }))
    expect(missing.status).toBe(400)
  })
})
