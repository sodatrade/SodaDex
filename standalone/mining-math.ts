const BPS = 10_000n
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b
export interface CurveState {
  buyFee: bigint; sellFee: bigint; buyTax: bigint; sellTax: bigint; snipe: bigint
  vQuote: bigint; vToken: bigint; sold: bigint; sellable: bigint
}
export function curveOutput(s: CurveState, buy: boolean, input: bigint): bigint {
  if (input <= 0n || s.vQuote <= 0n || s.vToken <= 0n) throw new Error('miningEmptyAmount')
  if (buy) {
    const fee = s.buyFee + s.buyTax + s.snipe
    if (fee >= BPS || s.sellable <= s.sold) throw new Error('miningNoLiquidity')
    const net = input - input * fee / BPS
    const output = s.vToken - ceilDiv(s.vQuote * s.vToken, s.vQuote + net)
    return output < s.sellable - s.sold ? output : s.sellable - s.sold
  }
  if (input > s.sold) throw new Error('miningEmptyAmount')
  const gross = s.vQuote - ceilDiv(s.vQuote * s.vToken, s.vToken + input)
  return gross - gross * s.sellFee / BPS - gross * s.sellTax / BPS
}
/** Router getAmountsOut omits token transfer tax; use actual wallet net output. */
export function taxedV2Output(input: bigint, reserveFab: bigint, reserveToken: bigint, buy: boolean, tax: bigint): bigint {
  if (input <= 0n || reserveFab <= 0n || reserveToken <= 0n || tax < 0n || tax >= BPS) throw new Error('miningNoLiquidity')
  const netInput = buy ? input : input - input * tax / BPS
  const reserveIn = buy ? reserveFab : reserveToken, reserveOut = buy ? reserveToken : reserveFab
  const gross = netInput * 997n * reserveOut / (reserveIn * 1000n + netInput * 997n)
  return buy ? gross - gross * tax / BPS : gross
}
export function minimumMiningAmount(amount: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new Error('miningInvalidSlippage')
  const result = amount * BigInt(10_000 - slippageBps) / BPS
  if (result <= 0n) throw new Error('miningEmptyAmount')
  return result
}
export function liquidityAmounts(a: bigint, b: bigint, reserveA: bigint, reserveB: bigint): [bigint, bigint] {
  if (a <= 0n || b <= 0n) throw new Error('miningEmptyAmount')
  if (reserveA === 0n && reserveB === 0n) return [a, b]
  if (reserveA <= 0n || reserveB <= 0n) throw new Error('miningNoLiquidity')
  const requiredB = a * reserveB / reserveA
  return requiredB <= b ? [a, requiredB] : [b * reserveA / reserveB, b]
}
