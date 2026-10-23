import { describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, type Abi, type Hex } from 'viem'
import { deployment, FACTORY_READ, V3_POOL_READ, V3_POSITION_READ } from '../src/contracts'
import { contractReadKind } from '../src/contract-reads'
import { proxyRpc } from '../src/rpc'
const fakePool = '0x1111111111111111111111111111111111111111'
describe('canonical read routing', () => {
  it('permits own position reads but rejects trailing bytes and foreign position managers', () => {
    const data = encodeFunctionData({ abi: V3_POSITION_READ, functionName: 'positions', args: [1n] })
    expect(contractReadKind(deployment.contracts.v3PositionManager, data)).toBe('read')
    expect(contractReadKind(deployment.contracts.v3PositionManager, `${data}00`)).toBeNull()
    expect(contractReadKind(fakePool, data)).toBeNull()
  })
  it('checks the factory registry rather than trusting an arbitrary pool factory() claim', async () => {
    const upstream = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { params: { to: string; data: Hex }[] }
      const abi: Abi = body.params[0].to.toLowerCase() === deployment.contracts.v3Factory.toLowerCase() ? FACTORY_READ : V3_POOL_READ
      const decoded = decodeFunctionData({ abi, data: body.params[0].data })
      const values: Record<string, unknown> = { factory: deployment.contracts.v3Factory, token0: '0x2222222222222222222222222222222222222222', token1: '0x3333333333333333333333333333333333333333', fee: 100, getPool: '0x4444444444444444444444444444444444444444' }
      return Response.json({ jsonrpc: '2.0', id: 1, result: encodeFunctionResult({ abi, functionName: decoded.functionName, result: values[decoded.functionName] }) })
    })
    const data = encodeFunctionData({ abi: V3_POOL_READ, functionName: 'slot0' })
    const request = new Request('https://soda.example/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'eth_call', params: [{ to: fakePool, data }, 'latest'] }) })
    const response = await proxyRpc(request, upstream)
    expect(response.status).toBe(400)
    expect(upstream).toHaveBeenCalledTimes(5)
    expect(upstream.mock.calls.every(([, options]) => !(JSON.parse(String(options?.body)) as { params: { data: string }[] }).params[0].data.startsWith('0x3850c7bd'))).toBe(true)
  })
})
