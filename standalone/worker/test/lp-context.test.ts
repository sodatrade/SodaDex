import { describe, expect, it, vi } from 'vitest'
import { encodeAbiParameters, encodeFunctionData, encodeFunctionResult, parseAbiParameters, type Address, type Hex } from 'viem'
import { validLiquidityContext } from '../src/lp-context'
import { deployment, NFT_READ, V4_POSITION_READ, ZERO } from '../src/contracts'
import { V3_LP, V4_LP } from '../src/lp-requests'
import { proxyRpc } from '../src/rpc'
const owner = deployment.owner as Address
const other = '0x1111111111111111111111111111111111111111'
const stable = '0x2222222222222222222222222222222222222222'
const withdraw = encodeFunctionData({ abi: V3_LP, functionName: 'decreaseLiquidity', args: [{ tokenId: 1n, liquidity: 1n, amount0Min: 0n, amount1Min: 0n, deadline: 2_000_000_000n }] })
function readResult(value: Hex): Response { return Response.json({ jsonrpc: '2.0', id: 1, result: value }) }
describe('LP ownership and pool context', () => {
  it('blocks an increase/decrease for a different NFT owner before sending the requested simulation upstream', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(readResult(encodeFunctionResult({ abi: NFT_READ, functionName: 'ownerOf', result: other })))
    const request = new Request('https://soda.example/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'eth_estimateGas', params: [{ from: owner, to: deployment.contracts.v3PositionManager, data: withdraw }] }) })
    expect((await proxyRpc(request, upstream)).status).toBe(400)
    expect(upstream).toHaveBeenCalledOnce()
    const body = JSON.parse(String(upstream.mock.calls[0][1]?.body)) as { params: { data: string }[] }
    expect(body.params[0].data.slice(0, 10)).toBe('0x6352211e') // ownerOf, not decreaseLiquidity.
  })
  it('binds V4 settlement to the actual NFT currencies at the requested block', async () => {
    const encode = (token: Address): Hex => encodeFunctionData({ abi: V4_LP, functionName: 'modifyLiquidities', args: [encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), ['0x0111', [encodeAbiParameters(parseAbiParameters('uint256,uint256,uint128,uint128,bytes'), [1n, 0n, 0n, 0n, '0x']), encodeAbiParameters(parseAbiParameters('address,address,address'), [ZERO as Address, token, owner])]]), 2_000_000_000n] })
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { params: { data: Hex }[] }
      return body.params[0].data.startsWith('0x6352211e') ? readResult(encodeFunctionResult({ abi: NFT_READ, functionName: 'ownerOf', result: owner })) : readResult(encodeFunctionResult({ abi: V4_POSITION_READ, functionName: 'getPoolAndPositionInfo', result: [{ currency0: ZERO as Address, currency1: stable, fee: 0, tickSpacing: 1, hooks: ZERO as Address }, 1n] }))
    })
    expect(await validLiquidityContext(deployment.contracts.v4PositionManager, encode(stable), owner, 0n, '0x12345', upstream)).toBe(true)
    expect(await validLiquidityContext(deployment.contracts.v4PositionManager, encode(other), owner, 0n, '0x12345', upstream)).toBe(false)
    expect(upstream.mock.calls.every(([, options]) => (JSON.parse(String(options?.body)) as { params: unknown[] }).params[1] === '0x12345')).toBe(true)
  })
})
