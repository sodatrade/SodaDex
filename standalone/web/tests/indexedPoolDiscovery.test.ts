import { decodeFunctionData, encodeFunctionResult, zeroAddress } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listPools } from '../src/liquidity/pools'
import { factoryAbi, poolAbi } from '../src/liquidity/abis'
import { LP_CONTRACTS } from '../src/liquidity/config'
import { marketV3 } from './tradeMarketFixture'

const mocked = vi.hoisted(() => ({ rpc: vi.fn(), catalog: vi.fn() }))
vi.mock('../src/lib/rpc', async () => ({ ...await vi.importActual('../src/lib/rpc'), rpc: mocked.rpc }))
vi.mock('../src/data/dex', () => ({ getPools: mocked.catalog }))
beforeEach(() => {
  mocked.rpc.mockReset(); mocked.catalog.mockReset()
  mocked.catalog.mockResolvedValue({ pools: [{ protocol: 'v3', id: marketV3.id, token0: marketV3.currency0.address,
    token1: marketV3.currency1.address, fee: marketV3.fee, tickSpacing: 1, hooks: zeroAddress }] })
  mocked.rpc.mockImplementation(async (method, params) => {
    if (method !== 'eth_call') throw new Error(`Unexpected browser scan: ${method}`)
    const tx = params[0]
    if (tx.to === LP_CONTRACTS.factory) {
      const decoded = decodeFunctionData({ abi: factoryAbi, data: tx.data })
      return encodeFunctionResult({ abi: factoryAbi, functionName: decoded.functionName,
        result: decoded.functionName === 'getPool' ? marketV3.address : 1 })
    }
    const decoded = decodeFunctionData({ abi: poolAbi, data: tx.data })
    return encodeFunctionResult({ abi: poolAbi, functionName: decoded.functionName,
      result: decoded.functionName === 'slot0' ? [marketV3.sqrtPriceX96, marketV3.tick, 0, 0, 0, 0, true] : marketV3.liquidity })
  })
})
describe('browser pool directory', () => {
  it('uses indexed candidates and live pool state without historical RPC scans', async () => {
    const result = await listPools()
    expect(result.map((p) => p.id)).toEqual([marketV3.id])
    expect(result[0].sqrtPriceX96).toBe(marketV3.sqrtPriceX96)
    expect(mocked.catalog).toHaveBeenCalledOnce()
    expect(mocked.rpc.mock.calls.every(([method]) => method === 'eth_call')).toBe(true)
  })
  it('rejects a catalog identity that differs from the real factory pool', async () => {
    mocked.catalog.mockResolvedValue({ pools: [{ protocol: 'v3', id: '0x4444444444444444444444444444444444444444',
      token0: marketV3.currency0.address, token1: marketV3.currency1.address, fee: marketV3.fee, tickSpacing: 1, hooks: zeroAddress }] })
    await expect(listPools()).rejects.toThrow('failed')
  })
})
