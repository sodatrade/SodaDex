import test from 'node:test'
import assert from 'node:assert/strict'
import { validateWalletInventoryApproval } from './execute-mining-wallet-inventory.mjs'
import { fileSha } from './mining-plan-artifacts.mjs'
import { ONLINE_OWNER } from './mining-online-assets.mjs'
import { INVENTORY_RECIPIENT, INVENTORY_PHASE } from './mining-wallet-inventory.mjs'

function fixture() {
  const sources = { inventory: 'frozen-code' }
  const rehearsal = { phase: INVENTORY_PHASE, chainId: 1952, localForkOnly: true, publicWrites: false,
    signing: false, rehearsalPassed: true, owner: ONLINE_OWNER, startNonce: '143', feeCapWei: '20000001',
    totalFeeUpperBoundWei: String(7n * 21000n * 20000001n), result: { completed: true },
    draft: { sourceSha256: structuredClone(sources), minerId: '8', listingId: '5', transferFabRaw: '600000000000',
      recipient: INVENTORY_RECIPIENT, nativePrincipalWei: '0', keeperFundingWei: '0', extraLiquidityFabRaw: '0' },
    transactions: Array.from({ length: 7 }, (_, i) => ({ status: '0x1', value: '0', nonce: String(143 + i), gas: '21000' })) }
  const bytes = Buffer.from(JSON.stringify(rehearsal))
  const approval = { approved: true, phase: 'mining-public-wallet-1952-v1', chainId: 1952,
    approvalReference: 'Explicit user approval fixture', owner: ONLINE_OWNER, wallet: INVENTORY_RECIPIENT,
    rehearsal: { sha256: fileSha(bytes) }, approvedBudget: { ownerPreparationGasCapWei: '100000000000000',
      totalNewGasCapWei: '1300000000000000', browserWalletGasCapWei: '1000000000000000',
      keeperAdditionalGasCapWei: '200000000000000', fabPrincipalCapRaw: '600000000000', additionalNativeWalletFundingWei: '0' } }
  return { rehearsal, bytes, approval, sources }
}
function validate(f) { return validateWalletInventoryApproval(f.rehearsal, f.bytes, f.approval, f.sources) }
test('the exact approved new phase can prepare inventory without inheriting the completed phase budget', () => {
  assert.doesNotThrow(() => validate(fixture()))
  for (const change of [f => { f.approval.approved = false }, f => { delete f.approval.approvalReference },
    f => { f.approval.phase = 'completed-previous-phase' }, f => { f.approval.chainId = 196 },
    f => { f.approval.wallet = ONLINE_OWNER }, f => { f.sources.inventory = 'changed' },
    f => { f.bytes = Buffer.from('changed rehearsal') }]) {
    const f = fixture(); change(f); assert.throws(() => validate(f))
  }
})
test('owner, browser and keeper ceilings cannot expand or fund another native wallet', () => {
  for (const key of ['ownerPreparationGasCapWei', 'totalNewGasCapWei', 'browserWalletGasCapWei',
    'keeperAdditionalGasCapWei', 'fabPrincipalCapRaw', 'additionalNativeWalletFundingWei']) {
    const f = fixture(); f.approval.approvedBudget[key] = String(BigInt(f.approval.approvedBudget[key]) + 1n)
    assert.throws(() => validate(f), /budget mismatch/)
  }
})
test('extra writes, principal changes, reordered nonces and incomplete rehearsals are rejected before signing', () => {
  for (const change of [f => { f.rehearsal.transactions.push(f.rehearsal.transactions[0]) },
    f => { f.rehearsal.transactions[0].value = '1' }, f => { f.rehearsal.transactions[2].nonce = '144' },
    f => { f.rehearsal.transactions[3].status = '0x0' }, f => { f.rehearsal.draft.keeperFundingWei = '1' },
    f => { f.rehearsal.draft.extraLiquidityFabRaw = '1' }, f => { f.rehearsal.result.completed = false },
    f => { f.rehearsal.totalFeeUpperBoundWei = '1' }]) {
    const f = fixture(); change(f); assert.throws(() => validate(f))
  }
})
