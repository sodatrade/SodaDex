import type { MiningAddress, MiningHash, MiningProductDeployment } from '../../../mining-products'

export interface MiningSubmission {
  hash: MiningHash; from: MiningAddress; to: MiningAddress; action: string; at: number
  status: 'pending' | 'success' | 'reverted'
  approval?: boolean
}
export interface MiningStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const key = (d: MiningProductDeployment): string => `sodadex:1952:mining:${d.version}`
export function loadMiningJournal(d: MiningProductDeployment, storage: MiningStorage = localStorage): MiningSubmission[] {
  try {
    const raw: unknown = JSON.parse(storage.getItem(key(d)) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((r): r is MiningSubmission => !!r && typeof r === 'object' &&
      typeof r.hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(r.hash) &&
      typeof r.from === 'string' && /^0x[0-9a-fA-F]{40}$/.test(r.from) && typeof r.to === 'string' &&
      // A historical receipt stays queryable before its dynamic project directory reloads.
      // Execution validates the current target separately; this journal never sends calls.
      /^0x[0-9a-fA-F]{40}$/.test(r.to) &&
      typeof r.action === 'string' && /^[a-zA-Z][a-zA-Z0-9]{0,60}$/.test(r.action) &&
      Number.isSafeInteger(r.at) && r.at > 0 && (r.approval === undefined || typeof r.approval === 'boolean') &&
      ['pending', 'success', 'reverted'].includes(r.status)).slice(-100)
  } catch { return [] }
}
export function saveMiningSubmission(d: MiningProductDeployment, item: MiningSubmission, storage: MiningStorage = localStorage): void {
  const entries = loadMiningJournal(d, storage).filter((r) => r.hash.toLowerCase() !== item.hash.toLowerCase())
  storage.setItem(key(d), JSON.stringify([...entries, item].slice(-100)))
}
