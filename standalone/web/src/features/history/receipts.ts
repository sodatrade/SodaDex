import type { Hex } from 'viem'
import { hexQuantity, isAddress, rpc } from '../../lib/rpc'
export interface PublicReceipt {
  hash: Hex; from: string; to: string | null; blockNumber: bigint; blockHash: Hex; status: 'success' | 'reverted'; gasUsed: bigint
}
export async function readReceipt(hash: Hex): Promise<PublicReceipt | null> {
  if (!/^0x[\da-f]{64}$/i.test(hash)) throw new Error('Invalid hash')
  if (hexQuantity(await rpc('eth_chainId')) !== 196n) throw new Error('Wrong chain')
  const value = await rpc('eth_getTransactionReceipt', [hash])
  if (value === null) return null
  if (!value || typeof value !== 'object') throw new Error('Invalid receipt')
  const r = value as Record<string, unknown>
  if (typeof r.transactionHash !== 'string' || r.transactionHash.toLowerCase() !== hash.toLowerCase() ||
    !isAddress(r.from) || !(r.to === null || isAddress(r.to)) || typeof r.blockHash !== 'string' ||
    !/^0x[\da-f]{64}$/i.test(r.blockHash) || !['0x0', '0x1'].includes(String(r.status))) throw new Error('Invalid receipt')
  return { hash, from: r.from, to: r.to, blockNumber: hexQuantity(r.blockNumber), blockHash: r.blockHash as Hex,
    gasUsed: hexQuantity(r.gasUsed), status: r.status === '0x1' ? 'success' : 'reverted' }
}
