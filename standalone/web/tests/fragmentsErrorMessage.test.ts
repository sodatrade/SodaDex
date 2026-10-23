import { describe, expect, it } from 'vitest'
import { fragmentErrorMessage } from '../src/fragments/errorMessage'
import { messages } from '../src/fragments/messages'

describe('safe transaction feedback', () => {
  it.each(['zh-CN', 'en', 'yue-HK'] as const)('summarizes nested insufficient funds without exposing call details in %s', locale => {
    const m = messages(locale)
    const error = new Error('Raw Call Arguments: value 12 ETH data 0x59542ca9', {
      cause: { name: 'InsufficientFundsError', details: 'insufficient funds for gas * price + value' },
    })
    expect(fragmentErrorMessage(error, m)).toBe(m.insufficientOkb)
  })
  it('keeps unknown RPC payloads private and handles cyclic error causes', () => {
    const error: { message: string; cause?: unknown } = { message: 'execution reverted data 0x12345678 stack: secret-debug' }
    error.cause = error
    expect(fragmentErrorMessage(error, messages('en'))).toBe(messages('en').actionError)
  })
  it('recognizes wallet rejection and preserves concise application validation', () => {
    const m = messages('zh-CN')
    expect(fragmentErrorMessage({ cause: { code: 4001 } }, m)).toBe(m.walletCancelled)
    expect(fragmentErrorMessage(new Error(m.amountError), m)).toBe(m.amountError)
  })
})
