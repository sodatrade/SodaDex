/** Wire format shared by the browser, IGNIX adapter and local order service. */
export type OrderAddress = `0x${string}`
export interface OrderPoolKey {
  currency0: OrderAddress; currency1: OrderAddress; fee: number; tickSpacing: number; hooks: OrderAddress
}
export interface SodaLimitOrder {
  chainId: 196; settlement: OrderAddress; maker: OrderAddress; inputToken: OrderAddress; outputToken: OrderAddress
  amountIn: string; minAmountOut: string; receiver: OrderAddress; nonce: string; expiry: string
  protocol: 3 | 4; pool: OrderPoolKey
}
export const ORDER_TYPES = {
  PermitWitnessTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }, { name: 'witness', type: 'SodaLimitOrder' },
  ],
  TokenPermissions: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }],
  SodaLimitOrder: [
    { name: 'chainId', type: 'uint256' }, { name: 'settlement', type: 'address' }, { name: 'maker', type: 'address' },
    { name: 'inputToken', type: 'address' }, { name: 'outputToken', type: 'address' }, { name: 'amountIn', type: 'uint256' },
    { name: 'minAmountOut', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' }, { name: 'protocol', type: 'uint8' }, { name: 'pool', type: 'PoolKey' },
  ],
  PoolKey: [
    { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
  ],
} as const
const ZERO = '0x0000000000000000000000000000000000000000'
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
function address(v: unknown, nonzero = true): OrderAddress {
  if (typeof v !== 'string' || !/^0x[0-9a-f]{40}$/i.test(v) || (nonzero && same(v, ZERO))) throw Error('Invalid order address')
  return v.toLowerCase() as OrderAddress
}
function uint(v: unknown, bits: number, positive = false): string {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]*)$/.test(v) || v.length > 78) throw Error('Invalid order integer')
  const n = BigInt(v)
  if ((positive && n === 0n) || n >= 2n ** BigInt(bits)) throw Error('Order integer out of range')
  return v
}
function exact(v: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k))) throw Error('Invalid order fields')
}
export function parseLimitOrder(value: unknown, expected: { settlement: string; wrappedNative: string; router?: string; permit2?: string }, now?: bigint): SodaLimitOrder {
  if (!record(value) || !record(value.pool)) throw Error('Invalid order')
  exact(value, ['chainId', 'settlement', 'maker', 'inputToken', 'outputToken', 'amountIn', 'minAmountOut', 'receiver', 'nonce', 'expiry', 'protocol', 'pool'])
  exact(value.pool, ['currency0', 'currency1', 'fee', 'tickSpacing', 'hooks'])
  const p = value.pool
  if (value.chainId !== 196 || (value.protocol !== 3 && value.protocol !== 4) ||
    typeof p.fee !== 'number' || !Number.isInteger(p.fee) || p.fee < 0 || p.fee >= 1_000_000 ||
    typeof p.tickSpacing !== 'number' || !Number.isInteger(p.tickSpacing) || p.tickSpacing < 1 || p.tickSpacing > 32767)
    throw Error('Invalid order pool')
  const pool: OrderPoolKey = { currency0: address(p.currency0, value.protocol === 3), currency1: address(p.currency1),
    fee: p.fee, tickSpacing: p.tickSpacing, hooks: address(p.hooks, false) }
  if (BigInt(pool.currency0) >= BigInt(pool.currency1) || !same(pool.hooks, ZERO)) throw Error('Invalid order pool')
  const order: SodaLimitOrder = { chainId: 196, settlement: address(value.settlement), maker: address(value.maker),
    inputToken: address(value.inputToken), outputToken: address(value.outputToken, false), receiver: address(value.receiver),
    amountIn: uint(value.amountIn, 128, true), minAmountOut: uint(value.minAmountOut, 128, true),
    nonce: uint(value.nonce, 256), expiry: uint(value.expiry, 48, true), protocol: value.protocol, pool }
  const output = order.protocol === 3 && same(order.outputToken, ZERO) ? address(expected.wrappedNative) : order.outputToken
  const forbiddenReceiver = [expected.settlement, expected.router, expected.permit2, '0x0000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000002'].filter((v): v is string => !!v)
  if (!same(order.settlement, expected.settlement) || forbiddenReceiver.some(v => same(v, order.receiver)) || same(order.inputToken, output) ||
    !((same(order.inputToken, pool.currency0) && same(output, pool.currency1)) || (same(order.inputToken, pool.currency1) && same(output, pool.currency0))) ||
    (now !== undefined && BigInt(order.expiry) <= now)) throw Error('Order binding or expiry mismatch')
  return order
}
export function orderMessage(order: SodaLimitOrder) {
  return { ...order, chainId: 196n, amountIn: BigInt(order.amountIn), minAmountOut: BigInt(order.minAmountOut),
    nonce: BigInt(order.nonce), expiry: BigInt(order.expiry) }
}
export function orderTypedData(order: SodaLimitOrder, permit2: OrderAddress) {
  return { domain: { name: 'Permit2', chainId: 196, verifyingContract: permit2 }, types: ORDER_TYPES,
    primaryType: 'PermitWitnessTransferFrom' as const, message: { permitted: { token: order.inputToken, amount: BigInt(order.amountIn) },
      spender: order.settlement, nonce: BigInt(order.nonce), deadline: BigInt(order.expiry), witness: orderMessage(order) } }
}
