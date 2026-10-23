import { afterEach, describe, expect, it, vi } from 'vitest'
import { rpc } from '../src/lib/readRpc'

const profile = vi.hoisted(() => ({ id: '1952-mining-test' }))
vi.mock('../src/network', () => ({ NETWORK: { get id(): string { return profile.id } } }))

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('network-specific RPC deadlines', () => {
  it.each([
    ['1952-mining-test', 'pending', 35_000],
    ['1952-mining-test', 'latest', 12_000],
    ['196-test', 'pending', 12_000],
  ] as const)('allows %s %s reads up to %i ms', async (id, block, timeout) => {
    profile.id = id
    const deadline = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ result: '0x1' })))
    expect(await rpc('eth_getBalance', ['0x1111111111111111111111111111111111111111', block])).toBe('0x1')
    expect(deadline).toHaveBeenCalledWith(timeout)
  })
})
