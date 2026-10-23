import { compactTinyDecimal } from './compactDecimal'
export type AmountError =
  | { code: 'amountInvalid' | 'amountZero' | 'amountTooLarge' | 'amountInsufficient' }
  | { code: 'amountPrecision'; decimals: number }
export type AmountResult =
  | { kind: 'empty' }
  | { kind: 'invalid'; error: AmountError }
  | { kind: 'valid'; units: bigint }

/** Decimal strings stay exact: balances and input never pass through floating point. */
export function parseAmount(value: string, decimals = 18): AmountResult {
  if (!value.trim()) {
    return { kind: 'empty' }
  }
  if (!/^\d*(\.\d*)?$/.test(value) || !/\d/.test(value)) {
    return { kind: 'invalid', error: { code: 'amountInvalid' } }
  }
  const [whole = '0', fraction = ''] = value.split('.')
  if (fraction.length > decimals) {
    return { kind: 'invalid', error: { code: 'amountPrecision', decimals } }
  }
  const units = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
  if (units === 0n) {
    return { kind: 'invalid', error: { code: 'amountZero' } }
  }
  if (units >= 2n ** 256n) {
    return { kind: 'invalid', error: { code: 'amountTooLarge' } }
  }
  return { kind: 'valid', units }
}

export function formatBalance(units: bigint, decimals = 18): string {
  if (units === 0n) {
    return '0'
  }
  const scale = 10n ** BigInt(decimals)
  const whole = units / scale
  const fraction = (units % scale).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '')
  if (whole === 0n && !fraction) {
    return compactTinyDecimal(`0.${(units % scale).toString().padStart(decimals, '0')}`) ?? '0'
  }
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

export function amountError(value: string, balance?: bigint, decimals = 18): AmountError | undefined {
  const amount = parseAmount(value, decimals)
  if (amount.kind === 'invalid') {
    return amount.error
  }
  if (amount.kind === 'valid' && balance !== undefined && amount.units > balance) {
    return { code: 'amountInsufficient' }
  }
  return undefined
}
