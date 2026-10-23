/** v3 pool: bound contributions to backing of LP actually minted, using integer units. */
export function roundedContribution(shares: bigint, okb: bigint, reserveShares: bigint, reserveOkb: bigint, supply: bigint): { shares: bigint; okb: bigint } {
  if (shares <= 0n || okb <= 0n || supply < 0n) throw new Error('Invalid contribution')
  if (supply === 0n) return { shares, okb }
  if (reserveShares <= 0n || reserveOkb <= 0n) throw new Error('Invalid reserves')
  const needed = shares * reserveOkb / reserveShares
  if (needed <= okb) okb = needed
  else shares = okb * reserveShares / reserveOkb
  const a = shares * supply / reserveShares, b = okb * supply / reserveOkb
  const minted = a < b ? a : b
  if (minted === 0n) throw new Error('Contribution too small')
  return { shares: (minted * reserveShares + supply - 1n) / supply, okb: (minted * reserveOkb + supply - 1n) / supply }
}
