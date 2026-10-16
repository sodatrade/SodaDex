import { afterEach, describe, expect, it, vi } from 'vitest'
import { getEvents, getPools, mergeEvents, type EventsResponse } from '../src/features/market/api'
import { readReceipt } from '../src/features/history/receipts'
const hash = `0x${'a'.repeat(64)}` as const
const address = `0x${'1'.repeat(40)}`
const base = { schemaVersion: 1 as const, chainId: 196 as const, asOf: { number: 10, hash, timestamp: 1 },
  coverage: { fromBlock: 1, toBlock: 10, complete: true, nextFromBlock: null } }
afterEach(() => vi.unstubAllGlobals())
describe('onchain market and history boundary', () => {
  it('rejects a wrong-chain data envelope and malformed event links', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ...base, chainId: 1, pools: [] }))
      .mockResolvedValueOnce(Response.json({ ...base, events: [{ transactionHash: 'javascript:alert(1)' }], nextCursor: null }))
    vi.stubGlobal('fetch', fetcher)
    await expect(getPools()).rejects.toThrow('Invalid pool data')
    await expect(getEvents({ owner: address, cursor: 'a+b/c=' })).rejects.toThrow('Invalid event data')
    expect(fetcher.mock.calls[1]?.[0]).toContain('cursor=a%2Bb%2Fc%3D')
  })
  it('deduplicates log identities and replaces a reorganized block without merging forks', () => {
    const event = { id: `${hash}:0`, protocol: 'v3' as const, address, event: 'Swap', blockNumber: 5,
      blockHash: hash, transactionHash: hash, logIndex: 0, args: {}, transactionFrom: address }
    const page: EventsResponse = { ...base, events: [event], nextCursor: null }
    expect(mergeEvents([page, page])).toHaveLength(1)
    const newHash = `0x${'b'.repeat(64)}`
    const canonical = { ...page, events: [{ ...event, id: `${newHash}:1`, blockHash: newHash, logIndex: 1 }] }
    expect(mergeEvents([page, canonical])).toEqual(canonical.events)
  })
  it('queries receipt only on X Layer and rejects a mismatched transaction', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ result: '0x1' }))
      .mockResolvedValueOnce(Response.json({ result: '0xc4' }))
      .mockResolvedValueOnce(Response.json({ result: { transactionHash: `0x${'b'.repeat(64)}`, from: address,
        to: address, blockHash: hash, status: '0x1', gasUsed: '0x1', blockNumber: '0x2' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(readReceipt(hash)).rejects.toThrow('Wrong chain')
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(readReceipt(hash)).rejects.toThrow('Invalid receipt')
  })
})
