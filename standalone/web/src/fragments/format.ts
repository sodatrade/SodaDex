import { formatEther } from 'viem'
/** Display-only truncation. Transaction quantities always retain their original bigint precision. */
export function formatBalance(value: bigint): string {
  if (value > 0n && value < 10n ** 12n) return '<0.000001'
  const [whole, fraction] = formatEther(value).split('.')
  const tail = fraction?.slice(0, Math.max(0, Math.min(6, 8 - whole.length))).replace(/0+$/, '')
  return tail ? `${whole}.${tail}` : whole
}
