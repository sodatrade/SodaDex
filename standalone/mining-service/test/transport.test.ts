import { describe, expect, it, vi } from 'vitest'
import { freshPending } from '../src/pending-rpc.ts'
import { HttpRpc } from '../src/rpc.ts'
import { wallet, d } from './fixture.ts'
function replies(stale: boolean, output: unknown = '0x1234'): unknown[] {
  return ['0x7a0', { number: '0x64', timestamp: '0x400' }, { number: stale ? '0x1' : '0x65', timestamp: stale ? '0x1' : '0x401' },
    '0x6000', stale ? '0x' : '0x6000', '0x2', stale ? '0x0' : '0x2', output]
}
describe('1952 RPC transport', () => {
  it('retries the whole same-backend pending proof after a stale view, never accepting its failed/empty call', async () => {
    const batch = vi.fn().mockResolvedValueOnce(replies(true, { rpcError: true })).mockResolvedValueOnce(replies(false))
    const wait = vi.fn().mockResolvedValue(undefined)
    const value = await freshPending({ request: vi.fn(), batch }, 'eth_call', [{ from: wallet.address, to: d.contracts.farm.address, data: '0x1234' }, 'pending'], wait)
    expect(value).toBe('0x1234'); expect(wait).toHaveBeenCalledWith(1000); expect(batch).toHaveBeenCalledTimes(2)
    expect(batch.mock.calls[0][0]).toHaveLength(8)
  })
  it('does not retry a fresh EVM revert and stops after bounded stale retries', async () => {
    const batch = vi.fn().mockResolvedValue(replies(false, { rpcError: true })), wait = vi.fn().mockResolvedValue(undefined)
    const args = [{ from: wallet.address, to: d.contracts.farm.address, data: '0x1234' }, 'pending']
    await expect(freshPending({ request: vi.fn(), batch }, 'eth_call', args, wait)).rejects.toThrow('simulation_reverted')
    expect(batch).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled()
    batch.mockReset().mockResolvedValue(replies(true))
    await expect(freshPending({ request: vi.fn(), batch }, 'eth_estimateGas', args, wait)).rejects.toThrow('pending_rpc_stale')
    expect(batch).toHaveBeenCalledTimes(6); expect(wait.mock.calls.map(c => c[0])).toEqual([1000, 2000, 4000, 4000, 4000])
  })
  it('batches independent reads in groups of at most ten and maps replies by id', async () => {
    const sizes: number[] = []
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const calls = JSON.parse(String(init?.body)) as { id: number; params: unknown[] }[]
      sizes.push(calls.length)
      return Response.json(calls.toReversed().map(c => ({ jsonrpc: '2.0', id: c.id, result: c.params[0] })))
    })
    const rpc = new HttpRpc('https://example.invalid/', fetcher)
    const values = await Promise.all(Array.from({ length: 13 }, (_, i) => rpc.request('test_read', [i])))
    expect(values).toEqual(Array.from({ length: 13 }, (_, i) => i)); expect(sizes).toEqual([10, 3])
  })
  it('does not retry raw broadcasts and rejects duplicate or missing RPC reply ids', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('response lost')), rpc = new HttpRpc('https://example.invalid/', fetcher)
    await expect(rpc.request('eth_sendRawTransaction', ['0x1234'])).rejects.toThrow('response lost')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const malformed = new HttpRpc('https://example.invalid/', vi.fn(async () => Response.json([{ jsonrpc: '2.0', id: 999, result: '0x1' }])))
    await expect(malformed.request('eth_chainId')).rejects.toThrow('rpc_invalid')
  })
})

describe('pinned block RPC identity', () => {
  it('rejects a different block height even when its hash has the right shape', async () => {
    const { block } = await import('../src/rpc.ts')
    const rpc = { request: vi.fn(async () => ({ number: '0x63', hash: `0x${'ab'.repeat(32)}`, timestamp: '0x400' })) }
    await expect(block(rpc, '0x64')).rejects.toThrow('rpc_height_mismatch')
  })
})
