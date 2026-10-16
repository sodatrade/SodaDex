import { type Address, type Hex } from 'viem'
import { TradeError, type PublicRpc } from './types'
export function transactionHash(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new TradeError('tradeFailed')
  return value as Hex
}
export async function receiptStatus(
  read: PublicRpc,
  hash: Hex,
  from: Address,
  to: Address,
): Promise<'pending' | 'success'> {
  const receipt = await read('eth_getTransactionReceipt', [hash])
  if (receipt === null) return 'pending'
  if (!receipt || typeof receipt !== 'object') throw new TradeError('tradeFailed')
  const r = receipt as Record<string, unknown>
  if (
    typeof r.transactionHash !== 'string' ||
    r.transactionHash.toLowerCase() !== hash.toLowerCase() ||
    typeof r.from !== 'string' ||
    r.from.toLowerCase() !== from.toLowerCase() ||
    typeof r.to !== 'string' ||
    r.to.toLowerCase() !== to.toLowerCase() ||
    typeof r.blockHash !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(r.blockHash)
  )
    throw new TradeError('tradeFailed')
  if (r.status === '0x0') throw new TradeError('tradeReverted')
  if (r.status !== '0x1') throw new TradeError('tradeFailed')
  return 'success'
}
export async function waitReceipt(
  read: PublicRpc,
  hash: Hex,
  from: Address,
  to: Address,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 150,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if ((await receiptStatus(read, hash, from, to)) === 'success') return
    if (attempt + 1 < attempts) await sleep(2000)
  }
  throw new TradeError('tradePending')
}
