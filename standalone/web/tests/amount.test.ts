import { describe, expect, it } from 'vitest'
import { amountError, formatBalance, parseAmount } from '../src/domain/amount'

describe('exact asset amounts', () => {
  it('preserves values beyond floating point precision', () => {
    expect(parseAmount('1.000000000000000001')).toEqual({ kind: 'valid', units: 1_000_000_000_000_000_001n })
    expect(parseAmount('.1')).toEqual({ kind: 'valid', units: 100_000_000_000_000_000n })
  })
  it.each(['-1', '1e2', 'NaN', '1,2', '.', '0', '0.0000000000000000001'])('rejects unsupported amount %s', (value) => {
    expect(parseAmount(value).kind).toBe('invalid')
  })
  it('compares exact balances and does not invent an error before balance arrives', () => {
    expect(amountError('1.000000000000000001', 1_000_000_000_000_000_000n)).toBe('可用余额不足')
    expect(amountError('1', 1_000_000_000_000_000_000n)).toBeUndefined()
    expect(amountError('1')).toBeUndefined()
    expect(parseAmount('')).toEqual({ kind: 'empty' })
  })
  it('does not round tiny nonzero balances to zero', () => {
    expect(formatBalance(1n)).toBe('< 0.000001')
    expect(formatBalance(1_234_567_890_000_000_000n)).toBe('1.234567')
    expect(formatBalance(0n)).toBe('0')
  })
})
