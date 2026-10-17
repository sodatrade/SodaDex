import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeFunctionData, encodeFunctionResult, type Address, type Hex } from 'viem'
import { deployment, FACTORY_READ, STATE_READ, ZERO } from '../src/contracts'
import { V3_QUOTE_READ, V4_QUOTE_READ } from '../src/quote-requests'
import { proxyRpc } from '../src/rpc'
import * as policy from '../../trading-policy'
const tokenA = '0x1111111111111111111111111111111111111111'
const tokenB = '0x2222222222222222222222222222222222222222'
const registered = '0x4444444444444444444444444444444444444444'
const key = { currency0: ZERO as Address, currency1: tokenA as Address, fee: 500, tickSpacing: 10, hooks: ZERO as Address }
const data3 = (): Hex => encodeFunctionData({ abi: V3_QUOTE_READ, functionName: 'quoteExactInputSingle', args: [{ tokenIn: tokenA, tokenOut: tokenB, amountIn: 100n, fee: 3000, sqrtPriceLimitX96: 0n }] })
const data4 = (hooks: Address = ZERO): Hex => encodeFunctionData({ abi: V4_QUOTE_READ, functionName: 'quoteExactInputSingle', args: [{ poolKey: { ...key, hooks }, zeroForOne: true, exactAmount: 100n, hookData: '0x' }] })
function request(to: string, data: Hex, method = 'eth_call'): Request {
  return new Request('https://soda.example/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params: method === 'eth_call' ? [{ to, data }, '0x12345'] : [{ to, data }] }) })
}
afterEach(() => vi.restoreAllMocks())
describe('read-only quotes for all self-deployed pools', () => {
  it('quotes a custom V3 pair only after its own factory confirms the exact pair and fee, including while swaps are paused', async () => {
    vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(false)
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { id: number; params: { to: string; data: string }[] }
      const result = body.params[0].to.toLowerCase() === deployment.contracts.v3Factory.toLowerCase() ? encodeFunctionResult({ abi: FACTORY_READ, functionName: 'getPool', result: registered }) : encodeFunctionResult({ abi: V3_QUOTE_READ, functionName: 'quoteExactInputSingle', result: [50n, 2n ** 96n, 1, 1000n] })
      return Response.json({ jsonrpc: '2.0', id: body.id, result })
    })
    expect((await proxyRpc(request(deployment.contracts.v3Quoter, data3()), upstream)).status).toBe(200)
    expect(upstream).toHaveBeenCalledTimes(2)
    const calls = upstream.mock.calls.map(([, options]) => JSON.parse(String(options?.body)) as { params: unknown[] })
    expect(calls.every((body) => body.params[1] === '0x12345')).toBe(true)
    expect(calls[0].params[0]).toMatchObject({ to: deployment.contracts.v3Factory })
  })
  it('rejects an unregistered V3 pair without invoking the quoter', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ jsonrpc: '2.0', id: 1, result: encodeFunctionResult({ abi: FACTORY_READ, functionName: 'getPool', result: ZERO }) }))
    expect((await proxyRpc(request(deployment.contracts.v3Quoter, data3()), upstream)).status).toBe(400)
    expect(upstream).toHaveBeenCalledOnce()
  })
  it('quotes a hookless V4 key only after own StateView confirms initialized nonzero sqrt price', async () => {
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { id: number; params: { to: string }[] }
      const result = body.params[0].to.toLowerCase() === deployment.contracts.v4StateView.toLowerCase() ? encodeFunctionResult({ abi: STATE_READ, functionName: 'getSlot0', result: [2n ** 96n, 0, 0, 500] }) : encodeFunctionResult({ abi: V4_QUOTE_READ, functionName: 'quoteExactInputSingle', result: [50n, 1000n] })
      return Response.json({ jsonrpc: '2.0', id: body.id, result })
    })
    expect((await proxyRpc(request(deployment.contracts.v4Quoter, data4()), upstream)).status).toBe(200)
    expect(upstream).toHaveBeenCalledTimes(2)
    const missing = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ jsonrpc: '2.0', id: 1, result: encodeFunctionResult({ abi: STATE_READ, functionName: 'getSlot0', result: [0n, 0, 0, 0] }) }))
    expect((await proxyRpc(request(deployment.contracts.v4Quoter, data4()), missing)).status).toBe(400)
    expect(missing).toHaveBeenCalledOnce()
  })
  it('rejects foreign quoters, hook substitutions, trailing bytes and gas simulations before upstream access', async () => {
    const upstream = vi.fn<typeof fetch>()
    for (const candidate of [request(registered, data3()), request(deployment.contracts.v3Quoter, `${data3()}00`), request(deployment.contracts.v4Quoter, data4(tokenB)), request(deployment.contracts.v4Quoter, data4(), 'eth_estimateGas')]) expect((await proxyRpc(candidate, upstream)).status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })
})
