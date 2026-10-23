// One acceptance-only recovery: preserve the executed prefix, refresh one finite Permit2 approval.
import { canonicalIntentData, assertAcceptanceBudget, assertAcceptanceProgress } from './ordinary-intent.mjs'
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const same=(a,b)=>a?.toLowerCase()===b?.toLowerCase()
export function assertJournalTotals(state) {
 for (const [field,rowField] of [['gasSpentWei','feeWei'],['nonGasSpentWei','value'],['fabSpentRaw','fabSpentRaw']]) {
  if(state.rows.some(row=>BigInt(row[rowField])<0n)||BigInt(state[field])!==state.rows.reduce((sum,row)=>sum+BigInt(row[rowField]),0n))throw Error('Journal totals do not match retained receipts')
 }
}
export function assertContinuation(base, child, baseline, continuation, hashes, permit2, caps) {
 const prefix=16
 if(continuation.kind!=='v4-finite-permit-refresh'||continuation.prefixCount!==prefix||continuation.basePlanSha256!==hashes.base||continuation.approvalSha256!==hashes.approval||continuation.baselineSha256!==hashes.baseline||continuation.remainingRehearsalSha256!==hashes.child)throw Error('Continuation evidence binding changed')
 if(base.rows.length!==24||baseline.rows.length!==prefix||baseline.pending||baseline.stopped||baseline.completed||baseline.continuationSha256||baseline.planSha256!==hashes.base||baseline.approvalSha256!==hashes.approval||baseline.productionTouched!==false||!same(baseline.owner,base.owner)||baseline.chainId!==196)throw Error('Continuation requires the original successful sixteen-row journal')
 assertJournalTotals(baseline)
 assertAcceptanceProgress(baseline,base,184,184)
 if(child.mode!=='owned-final-signer-fork'||child.chainId!==196||child.publicChainWrites!==0||!same(child.owner,base.owner)||child.startNonce!==184||child.rows.length!==9||!equal(child.runtimeHashes,base.runtimeHashes)||!equal(child.results,base.results.filter(r=>r.protocol==='v4')))throw Error('Remaining rehearsal differs from the approved TEST scope')
 if(!equal(continuation.rows,[...base.rows.slice(0,prefix),...child.rows])||continuation.rows.length>28)throw Error('Continuation rewrote the executed prefix')
 const added=child.rows[0],prior=base.rows[prefix-1]
 if(!same(added.to,permit2)||added.label!=='v4:increase'||added.data.slice(0,10)!=='0x87517c45'||BigInt(added.value)!==0n||BigInt(added.maximumFabSpendRaw)!==0n||canonicalIntentData(added.data,0n,false)!==canonicalIntentData(prior.data,0n,false)||!same(prior.to,permit2))throw Error('Only the same finite Permit2 amount/spender can be refreshed')
 const state={...baseline}
 for(let i=0;i<child.rows.length;i++) {
  const row=child.rows[i],expected=i===0?prior:base.rows[prefix+i-1]
  if(!same(row.to,expected.to)||row.label!==expected.label||BigInt(row.value)!==BigInt(expected.value)||BigInt(row.maximumFabSpendRaw)<0n||BigInt(row.maximumFabSpendRaw)>BigInt(expected.maximumFabSpendRaw)||canonicalIntentData(row.data,0n,false)!==canonicalIntentData(expected.data,0n,false)||BigInt(row.plannedGasLimit)<=0n||BigInt(row.gasEstimate)<=0n||BigInt(row.plannedGasLimit)<BigInt(row.gasEstimate)||BigInt(row.plannedGasLimit)>BigInt(expected.plannedGasLimit)*2n)throw Error('Remaining action, asset, amount or gas scope changed')
  assertAcceptanceBudget(state,row,BigInt(caps.maxGasPriceWei),caps)
  state.gasSpentWei=String(BigInt(state.gasSpentWei)+BigInt(row.plannedGasLimit)*BigInt(caps.maxGasPriceWei))
  state.nonGasSpentWei=String(BigInt(state.nonGasSpentWei)+BigInt(row.value))
  state.fabSpentRaw=String(BigInt(state.fabSpentRaw)+BigInt(row.maximumFabSpendRaw))
 }
 return {...base,rows:continuation.rows}
}
export function assertRetainedPrefix(state, baseline, continuationHash) {
 if(state.continuationSha256!==continuationHash||!equal(state.rows.slice(0,baseline.rows.length),baseline.rows)||state.rows.length<baseline.rows.length||!state.continuationActivatedAt)throw Error('Activated continuation or retained receipts changed')
 assertJournalTotals(state)
}
