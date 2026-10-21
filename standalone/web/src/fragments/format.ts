import { formatEther } from 'viem'
import { compactTinyDecimal } from '../domain/compactDecimal'
/** Display-only truncation. Transaction quantities always retain their original bigint precision. */
export function formatBalance(value: bigint): string {
  const tiny = compactTinyDecimal(formatEther(value))
  if (tiny) return tiny
  const [whole, fraction] = formatEther(value).split('.')
  const tail = fraction?.slice(0, Math.max(0, Math.min(6, 8 - whole.length))).replace(/0+$/, '')
  return tail ? `${whole}.${tail}` : whole
}
