import { afterEach, describe, expect, it, vi } from 'vitest'
import { STABLE_ADDRESS, WOKB_ADDRESS } from '../src/domain/assets'
import { getReferencePools, getReferenceQuote, getReferenceTokens } from '../src/features/explore/referenceApi'
import { getExploreCatalog, mergeCatalog } from '../src/features/explore/catalog'
import * as reference from '../src/features/explore/referenceApi'
import * as currencies from '../src/liquidity/currencies'
import { referenceOther, referencePool, referencePools, referenceToken } from './exploreFixtures'
afterEach(() => vi.unstubAllGlobals())
describe('read-only official reference data', () => {
  it('reads exact raw strings without floating-point conversion and binds the quoted pool and pair', async () => {
    const amount = 123456789012345678901234n
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...referencePools, amountInRaw: amount.toString(), amountOutRaw: '900719925474099300000001',
      tokenIn: STABLE_ADDRESS, tokenOut: WOKB_ADDRESS, protocol: 'v3', poolId: referencePool.id })))
    vi.stubGlobal('fetch', fetch)
    const result = await getReferenceQuote(referencePool, true, amount)
    expect(result.amountOutRaw).toBe('900719925474099300000001')
    const params = new URL(String(fetch.mock.calls[0][0]), 'https://test.invalid').searchParams
    expect(params.get('amountInRaw')).toBe(amount.toString())
    expect(params.get('fee')).toBe('500')
    expect(params.get('tickSpacing')).toBe('10')
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('body')
  })
  it.each([{ source: 'sodadex' }, { readOnly: false }, { chainId: 1 }])('rejects a mismatched source envelope %j', async (change) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...referencePools, ...change }))))
    await expect(getReferencePools(STABLE_ADDRESS, WOKB_ADDRESS)).rejects.toThrow('Invalid reference pools')
  })
  it('keeps empty candidates distinct from partial upstream failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...referencePools, pools: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...referencePools, pools: [], errors: [{ protocol: 'v3', fee: 500, tickSpacing: null, message: 'failed' }] }))))
    expect((await getReferencePools(STABLE_ADDRESS, WOKB_ADDRESS)).errors).toEqual([])
    expect((await getReferencePools(STABLE_ADDRESS, WOKB_ADDRESS)).errors).toHaveLength(1)
  })
  it('rejects malformed token metadata, quote direction and network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ ...referencePools, tokens: [{ ...referenceToken, decimals: 256 }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...referencePools, amountInRaw: '1', amountOutRaw: '1', tokenIn: WOKB_ADDRESS, tokenOut: STABLE_ADDRESS, protocol: 'v3', poolId: referencePool.id })))
      .mockResolvedValueOnce(new Response('', { status: 502 })))
    await expect(getReferenceTokens()).rejects.toThrow('Invalid reference tokens')
    await expect(getReferenceQuote(referencePool, true, 1n)).rejects.toThrow('Invalid reference quote')
    await expect(getReferencePools(STABLE_ADDRESS, WOKB_ADDRESS)).rejects.toThrow('Reference data unavailable')
  })
  it('merges curated and locally re-read metadata without duplicate addresses', async () => {
    vi.spyOn(reference, 'getReferenceTokens').mockResolvedValue([referenceToken, referenceOther])
    vi.spyOn(currencies, 'importCurrency').mockRejectedValue(Error('bad metadata'))
    const result = await getExploreCatalog([STABLE_ADDRESS])
    expect(result.tokens.filter(v => v.currency.address.toLowerCase() === STABLE_ADDRESS.toLowerCase())).toHaveLength(1)
    expect(result.partial).toBe(true)
    expect(mergeCatalog([result.tokens[0], result.tokens[0]])).toHaveLength(1)
  })
})
