import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, encodeFunctionResult, type Address } from 'viem'
import { deployment, FACTORY_READ, STATE_READ, V3_POOL_READ, ZERO } from '../src/contracts'
import { poolId } from '../src/dex-data'
import { proxyRpc } from '../src/rpc'
import * as policy from '../../trading-policy'
import { owner, request, tokenA, tokenB, v3, v4, type Transaction } from './trade-fixtures'
beforeEach(() => { vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(true) })
afterEach(() => vi.restoreAllMocks())
const registered = '0x4444444444444444444444444444444444444444'
interface RpcBody { id: number; method: string; params: [{ to: string; data: `0x${string}` }, string?] }
function upstream(available = true, initialized = true): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
    const body = JSON.parse(String(options?.body)) as RpcBody
    let result = body.method === 'eth_estimateGas' ? '0x10000' : '0x'
    if (body.params[0].to.toLowerCase() === deployment.contracts.v3Factory.toLowerCase()) result = encodeFunctionResult({ abi: FACTORY_READ, functionName: 'getPool', result: available ? registered : ZERO })
    if (body.params[0].to.toLowerCase() === registered) result = encodeFunctionResult({ abi: V3_POOL_READ, functionName: 'slot0', result: [initialized ? 2n ** 96n : 0n, 0, 0, 1, 1, 0, true] })
    if (body.params[0].to.toLowerCase() === deployment.contracts.v4StateView.toLowerCase()) result = encodeFunctionResult({ abi: STATE_READ, functionName: 'getSlot0', result: [available ? 2n ** 96n : 0n, 0, 0, 500] })
    return Response.json({ jsonrpc: '2.0', id: body.id, result })
  })
}
const sent = (mock: ReturnType<typeof upstream>): RpcBody[] => mock.mock.calls.map(([, options]) => JSON.parse(String(options?.body)) as RpcBody)

describe('registered Router simulation context', () => {
  it.each([100, 500, 3000, 10000])('registers the exact custom V3 pair and fee %s at the caller block before simulating', async (fee) => {
    const tx = v3(tokenB, tokenA, fee)
    const fetcher = upstream()
    expect((await proxyRpc(request(tx), fetcher)).status).toBe(200)
    const calls = sent(fetcher)
    expect(calls).toHaveLength(3)
    expect(calls[0].params[0].to).toBe(deployment.contracts.v3Factory)
    expect(decodeFunctionData({ abi: FACTORY_READ, data: calls[0].params[0].data }).args).toEqual([tokenB, tokenA, fee])
    expect(calls.every((call) => call.params[1] === '0x12345')).toBe(true)
    expect(calls[1].params[0].to).toBe(registered)
    expect(decodeFunctionData({ abi: V3_POOL_READ, data: calls[1].params[0].data }).functionName).toBe('slot0')
    expect(calls[2].params[0]).toEqual(tx)
  })
  it('requires initialized own V4 PoolManager state for the exact hookless key, in either direction', async () => {
    for (const [input, output] of [[ZERO, tokenA], [tokenA, ZERO], [tokenA, tokenB], [tokenB, tokenA]] as const) {
      const tx = v4(input, output)
      const fetcher = upstream()
      expect((await proxyRpc(request(tx), fetcher)).status).toBe(200)
      const calls = sent(fetcher)
      expect(calls).toHaveLength(2)
      const key = BigInt(input) < BigInt(output) ? [input, output] : [output, input]
      expect(calls[0].params[0].to).toBe(deployment.contracts.v4StateView)
      expect(decodeFunctionData({ abi: STATE_READ, data: calls[0].params[0].data }).args).toEqual([poolId(key[0], key[1], 500, 10, ZERO)])
      expect(calls.every((call) => call.params[1] === '0x12345')).toBe(true)
    }
  })
  it('rejects unregistered/uninitialized pools before either Router call or gas estimation', async () => {
    for (const tx of [v3(), v4()]) for (const method of ['eth_call', 'eth_estimateGas']) {
      const fetcher = upstream(false)
      const response = await proxyRpc(request(tx, method), fetcher)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ id: 7, error: { message: 'Pool is not registered or initialized' } })
      expect(fetcher).toHaveBeenCalledOnce()
      expect(sent(fetcher)[0].params[0].to).not.toBe(deployment.contracts.universalRouter)
    }
  })
  it('checks native V3 routes against their exact registered WOKB pair before gas estimation', async () => {
    const wrapped = deployment.wrappedNative as Address
    for (const tx of [v3(wrapped, tokenA, 500, 'nativeIn'), v3(tokenB, wrapped, 10000, 'nativeOut')]) {
      const fetcher = upstream()
      expect((await proxyRpc(request(tx, 'eth_estimateGas'), fetcher)).status).toBe(200)
      const calls = sent(fetcher)
      expect(calls[0].params[1]).toBe('latest')
      expect(calls[1].params[1]).toBe('latest')
      expect(calls[2].method).toBe('eth_estimateGas')
      expect(calls[2].params).toEqual([tx])
    }
  })
  it('rejects a created but uninitialized V3 pool before Router simulation, even though Factory registration exists', async () => {
    for (const method of ['eth_call', 'eth_estimateGas']) {
      const fetcher = upstream(true, false)
      expect((await proxyRpc(request(v3(), method), fetcher)).status).toBe(400)
      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(sent(fetcher).every((call) => call.params[0].to !== deployment.contracts.universalRouter)).toBe(true)
    }
  })
  it('rejects foreign targets, hooks, diverted recipients, values and trailing data without upstream access', async () => {
    const tx = v3()
    const invalid: Transaction[] = [{ ...tx, to: owner }, { ...tx, data: `${tx.data}00` }, { ...tx, value: '0x64' }, v4(tokenA, tokenB, 500, 10, tokenA)]
    const fetcher = upstream()
    for (const candidate of invalid) expect((await proxyRpc(request(candidate), fetcher)).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('fails closed on registry transport errors before Router simulation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }))
    expect((await proxyRpc(request(v3()), fetcher)).status).toBe(502)
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
