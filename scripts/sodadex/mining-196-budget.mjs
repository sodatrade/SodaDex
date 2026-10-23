import { formatEther } from 'viem'

/** Measured journal groups, not independent spending allocations. Sum equals the single phase. */
export function summarize196Budget(rows, feeCap) {
  const boundary = rows.findIndex((r) => r.label === 'Mint five test NAND units')
  const business = rows.findIndex((r) => r.label === 'Seed real TEST FAB/native liquidity') - 1 // preceding bounded FAB approval
  if (boundary < 0 || business <= boundary || rows.some((r) => r.status !== '0x1')) throw new Error('Incomplete successful 196 journal')
  const summarize = (items) => {
    const gasUsed = items.reduce((s, r) => s + BigInt(r.gasUsed), 0n)
    const gasLimits = items.reduce((s, r) => s + BigInt(r.gas), 0n)
    const additional = items.reduce((s, r) => s + BigInt(r.l1FeeUpperBoundWei) + BigInt(r.operatorFeeUpperBoundWei), 0n)
    return { transactions: items.length, gasUsed: String(gasUsed), gasLimits: String(gasLimits),
      observedExecutionCostWei: String(gasUsed * feeCap), feeUpperBoundWei: String(gasLimits * feeCap + additional),
      feeUpperBoundOKB: formatEther(gasLimits * feeCap + additional) }
  }
  const groups = { deployment: summarize(rows.slice(0, boundary)), inventory: summarize(rows.slice(boundary, business)),
    businessAcceptance: summarize(rows.slice(business)), fullPhase: summarize(rows) }
  const backendLabels = ['Signed farm miner procurement', 'Recognise actual curve tax', 'Fund shared miner procurement',
    'Convert actual project tax to FAB', 'Recognise converted tax', 'Reinvest converted tax in farm budget']
  groups.backendSubsetAlreadyIncluded = summarize(rows.filter((r) => backendLabels.includes(r.label)))
  groups.additionalBrowserReplayAllowance = summarize(rows.slice(business))
  groups.additionalBrowserReplayAllowance.note = 'Optional second execution of all measured business calls. Already executed once in local rehearsal; this allowance must not be represented as current spending or browser proof.'
  return groups
}
