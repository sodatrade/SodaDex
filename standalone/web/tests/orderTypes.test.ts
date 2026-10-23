import { describe, expect, it } from 'vitest'
import { hashTypedData } from 'viem'
import { orderTypedData, parseLimitOrder, type SodaLimitOrder } from '../../order-types'
import { ignixLaunchUrl } from '../src/domain/linkedSites'
import { CONTRACTS } from '../src/trading/config'
import { STABLE_ADDRESS, WOKB_ADDRESS } from '../src/domain/assets'
const settlement = '0x1111111111111111111111111111111111111111'
const maker = '0x2222222222222222222222222222222222222222'
const input: SodaLimitOrder = { chainId: 196, settlement, maker, inputToken: WOKB_ADDRESS, outputToken: STABLE_ADDRESS,
  receiver: maker, amountIn: '1000000000000', minAmountOut: '100', nonce: '1', expiry: '2000000000', protocol: 3,
  pool: { currency0: STABLE_ADDRESS, currency1: WOKB_ADDRESS, fee: 100, tickSpacing: 1, hooks: '0x0000000000000000000000000000000000000000' } }
const pins = { settlement, wrappedNative: WOKB_ADDRESS }
describe('signed order wire contract', () => {
  it('keeps exact amounts and binds every field into the Permit2 witness', () => {
    const order = parseLimitOrder(input, pins, 1n)
    const base = hashTypedData(orderTypedData(order, CONTRACTS.permit2))
    for (const change of [{ minAmountOut: '101' }, { receiver: settlement }, { nonce: '2' }, { expiry: '2000000001' }] as const)
      expect(hashTypedData(orderTypedData({ ...order, ...change }, CONTRACTS.permit2))).not.toBe(base)
    expect(order.amountIn).toBe('1000000000000')
  })
  it.each([
    { chainId: 1 }, { settlement: maker }, { inputToken: '0x0000000000000000000000000000000000000000' },
    { amountIn: '01' }, { minAmountOut: '0' }, { amountIn: String(2n ** 128n) }, { expiry: '1' }, { nonce: '-1' },
    { pool: { ...input.pool, hooks: maker } }, { pool: { ...input.pool, currency0: WOKB_ADDRESS } }, { unexpected: true },
  ])('rejects an unbound or malformed order %#', (change) => expect(() => parseLimitOrder({ ...input, ...change }, pins, 1n)).toThrow())
  it('uses the environment-specific IGNIX destination', () => {
    expect(ignixLaunchUrl('test')).toBe('https://dev.3.meme/create')
    expect(ignixLaunchUrl('production')).toBe('https://ignix.bot/create')
  })
})
