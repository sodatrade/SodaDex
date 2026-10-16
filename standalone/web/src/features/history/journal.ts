import type { Address, Hex } from 'viem'
import { CHAIN_ID } from '../../domain/assets'

export type TransactionState = 'pending' | 'success' | 'reverted'
export interface SubmittedTransaction {
  chainId: number
  hash: Hex
  account: Address
  to: Address
  kind: string
  submittedAt: number
  status: TransactionState
}
const STORAGE_KEY = 'sodadex.transactions.v1'
export const JOURNAL_CHANGED = 'sodadex:transactions'
const address = (v: unknown): v is Address => typeof v === 'string' && /^0x[\da-f]{40}$/i.test(v)
const hash = (v: unknown): v is Hex => typeof v === 'string' && /^0x[\da-f]{64}$/i.test(v)

function valid(value: unknown): value is SubmittedTransaction {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.chainId === CHAIN_ID && hash(v.hash) && address(v.account) && address(v.to) &&
    typeof v.kind === 'string' && v.kind.length <= 80 && typeof v.submittedAt === 'number' &&
    Number.isSafeInteger(v.submittedAt) && v.submittedAt > 0 &&
    ['pending', 'success', 'reverted'].includes(String(v.status))
}

/** Public transaction metadata only. A wallet key or signed payload never enters storage. */
export function readTransactions(account?: string): SubmittedTransaction[] {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(values)) return []
    const unique = new Map<string, SubmittedTransaction>()
    for (const value of values) if (valid(value)) unique.set(value.hash.toLowerCase(), value)
    return [...unique.values()]
      .filter((v) => !account || v.account.toLowerCase() === account.toLowerCase())
      .sort((a, b) => b.submittedAt - a.submittedAt)
  } catch { return [] }
}

export function recordTransaction(value: SubmittedTransaction): void {
  if (!valid(value)) throw new Error('Invalid transaction record')
  try {
    const entries = readTransactions().filter((entry) => entry.hash.toLowerCase() !== value.hash.toLowerCase())
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...entries, value]))
    window.dispatchEvent(new Event(JOURNAL_CHANGED))
  } catch { /* The wallet hash remains visible even when browser storage is unavailable. */ }
}

export function updateTransaction(hash: Hex, status: TransactionState): void {
  const value = readTransactions().find((entry) => entry.hash.toLowerCase() === hash.toLowerCase())
  if (value) recordTransaction({ ...value, status })
}
