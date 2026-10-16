export type AmountResult = { kind: 'empty' } | { kind: 'invalid'; message: string } | { kind: 'valid'; units: bigint }

/** Decimal strings stay exact: balances and input never pass through floating point. */
export function parseAmount(value: string, decimals = 18): AmountResult {
  if (!value.trim()) {
    return { kind: 'empty' }
  }
  if (!/^\d*(\.\d*)?$/.test(value) || !/\d/.test(value)) {
    return { kind: 'invalid', message: '请输入有效的资产数量' }
  }
  const [whole = '0', fraction = ''] = value.split('.')
  if (fraction.length > decimals) {
    return { kind: 'invalid', message: `最多支持 ${decimals} 位小数` }
  }
  const units = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
  if (units === 0n) {
    return { kind: 'invalid', message: '数量需要大于 0' }
  }
  if (units >= 2n ** 256n) {
    return { kind: 'invalid', message: '输入数量超出支持范围' }
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
    return '< 0.000001'
  }
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

export function amountError(value: string, balance?: bigint): string | undefined {
  const amount = parseAmount(value)
  if (amount.kind === 'invalid') {
    return amount.message
  }
  if (amount.kind === 'valid' && balance !== undefined && amount.units > balance) {
    return '可用余额不足'
  }
  return undefined
}
