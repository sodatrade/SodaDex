import { describe, expect, it } from 'vitest'
import { readTransactions, recordTransaction, updateTransaction } from '../src/features/history/journal'

const entry = { chainId: 196, hash: `0x${'a'.repeat(64)}` as const, account: `0x${'1'.repeat(40)}` as const,
  to: `0x${'2'.repeat(40)}` as const, kind: 'mint', submittedAt: 1, status: 'pending' as const }
describe('submitted transaction recovery', () => {
  it('survives a new read, deduplicates hashes and isolates accounts', () => {
    recordTransaction(entry)
    recordTransaction({ ...entry, submittedAt: 2 })
    expect(readTransactions(entry.account)).toHaveLength(1)
    expect(readTransactions(`0x${'3'.repeat(40)}`)).toEqual([])
    expect(readTransactions(entry.account)[0]?.submittedAt).toBe(1)
    updateTransaction(entry.hash, 'success')
    expect(readTransactions(entry.account)[0]?.status).toBe('success')
  })
  it('rejects malformed browser storage without interpreting it as a transaction', () => {
    localStorage.setItem('sodadex.transactions.v1', JSON.stringify([{ ...entry, chainId: 1 }, { ...entry, hash: 'javascript:alert(1)' }]))
    expect(readTransactions()).toEqual([])
    localStorage.setItem('sodadex.transactions.v1', '{')
    expect(readTransactions()).toEqual([])
  })
})
