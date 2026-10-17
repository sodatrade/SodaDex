import { afterEach, describe, expect, it, vi } from 'vitest'
import { keccak256 } from 'viem'
import { Keeper } from '../src/keeper.ts'
import { Planner } from '../src/planner.ts'
import { Repository } from '../src/repository.ts'
import { fixture, d, now, keeperSigner, signer, header } from './fixture.ts'
afterEach(() => vi.restoreAllMocks())
function setup() {
  const f = fixture(); f.c.expectedSigner = signer.address
  const project = d.projects[0]
  f.rpc.set('balanceOf', 100n, d.contracts.fab.address)
  const planner = new Planner(f.c, d, f.repo, f.rpc, f.discovery, signer, () => now)
  const sign = vi.fn(keeperSigner.signTransaction)
  const keeper = new Keeper(f.c, d, f.repo, f.rpc, planner, { ...keeperSigner, signTransaction: sign }, () => now)
  return { ...f, project, planner, keeper, sign }
}
function receipt(hash: string, status = '0x1') { return { transactionHash: hash, status, blockNumber: header.number, blockHash: header.hash, gasUsed: '0x5208', effectiveGasPrice: '0x1', l1Fee: '0x0', operatorFee: '0x0' } }
describe('durable keeper', () => {
  it('does not sign or broadcast a failed simulation or an exhausted budget', async () => {
    const f = setup(); f.rpc.simulateFailure = true
    await expect(f.keeper.runOnce()).rejects.toThrow('simulation_reverted')
    expect(f.sign).not.toHaveBeenCalled(); expect(f.rpc.sent).toHaveLength(0); expect(f.repo.read().reservedWei).toBe('0')
    f.rpc.simulateFailure = false; f.c.gasCapWei = 1n; f.repo.change(s => { s.cursor = 0 })
    await expect(f.keeper.runOnce()).rejects.toThrow('gas_budget_exhausted')
    expect(f.sign).not.toHaveBeenCalled(); expect(f.rpc.sent).toHaveLength(0)
  })
  it('persists exact raw/hash and gas reserve before broadcast, never changes nonce after response loss and restart', async () => {
    const f = setup(); f.rpc.broadcastFailure = true
    f.rpc.onBroadcast = raw => { const e = f.repo.read().executions[keccak256(raw)]; expect(e.raw).toBe(raw); expect(e.broadcasts).toBe(1); expect(BigInt(f.repo.read().reservedWei)).toBeGreaterThan(0n) }
    await f.keeper.runOnce()
    const e = Object.values(f.repo.read().executions)[0]
    expect(e.status).toBe('broadcast'); expect(f.sign).toHaveBeenCalledTimes(1)
    f.rpc.onBroadcast = undefined
    const restarted = new Keeper(f.c, d, new Repository(f.storage, d), f.rpc, f.planner, { ...keeperSigner, signTransaction: f.sign }, () => now)
    await restarted.runOnce()
    expect(f.rpc.sent).toEqual([e.raw, e.raw]); expect(f.sign).toHaveBeenCalledTimes(1)
    await restarted.runOnce(); expect(f.rpc.sent).toHaveLength(2); expect(f.sign).toHaveBeenCalledTimes(1)
    expect(f.repo.read().jobs[e.jobId].reason).toBe('broadcast_unknown')
  })
  it('settles success and revert receipts using actual cost, releasing only known unused reserve', async () => {
    for (const status of ['0x1', '0x0']) {
      const f = setup(); await f.keeper.runOnce(); const e = Object.values(f.repo.read().executions)[0]
      f.rpc.receipts.set(e.hash, receipt(e.hash, status)); await f.keeper.runOnce()
      expect(f.repo.read().spentWei).toBe('21000'); expect(f.repo.read().reservedWei).toBe('0')
      expect(f.repo.read().executions[e.hash].status).toBe(status === '0x1' ? 'confirmed' : 'reverted')
      expect(f.sign).toHaveBeenCalledTimes(1)
    }
  })
  it('retains a public receipt entry after the live job returns to waiting', async () => {
    const f = setup(); await f.keeper.runOnce(); const e = Object.values(f.repo.read().executions)[0]
    f.rpc.receipts.set(e.hash, receipt(e.hash)); await f.keeper.runOnce()
    f.rpc.set('balanceOf', 0n, d.contracts.fab.address); f.repo.change(s => { s.cursor = 0 })
    await f.keeper.runOnce()
    expect(f.repo.read().jobs[e.jobId].status).toBe('waiting')
    expect(f.repo.read().jobs[`execution:${e.hash}`]).toMatchObject({ hash: e.hash, status: 'confirmed', reason: 'settled' })
    expect(f.repo.read().jobs[`execution:${e.hash}`]).not.toHaveProperty('raw')
  })
  it('keeps full reserve when nonce moves without the original receipt; does not sign another transaction', async () => {
    const f = setup(); await f.keeper.runOnce(); const e = Object.values(f.repo.read().executions)[0]
    f.rpc.nonce = 1n; f.rpc.pendingNonce = 1n; await f.keeper.runOnce()
    expect(f.repo.read().executions[e.hash].status).toBe('nonce_conflict')
    expect(f.repo.read().reservedWei).toBe(e.maxCostWei); expect(f.repo.read().spentWei).toBe('0')
    await f.keeper.runOnce(); expect(f.sign).toHaveBeenCalledTimes(1); expect(f.rpc.sent).toHaveLength(1)
  })
  it('restores reserve after a confirmed receipt disappears in a reorg', async () => {
    const f = setup(); await f.keeper.runOnce(); const e = Object.values(f.repo.read().executions)[0]
    f.rpc.receipts.set(e.hash, receipt(e.hash)); await f.keeper.runOnce()
    f.rpc.receipts.delete(e.hash); f.rpc.broadcastFailure = true
    const changedHash = `0x${'cd'.repeat(32)}` as const, original = f.rpc.request.bind(f.rpc)
    vi.spyOn(f.rpc, 'request').mockImplementation((m, p) => m === 'eth_getBlockByNumber' ? Promise.resolve({ ...header, hash: changedHash, timestamp: '0x3e8' }) : original(m, p))
    vi.spyOn(f.discovery, 'verifyBase').mockResolvedValue({ ...header, hash: changedHash })
    await f.keeper.runOnce()
    expect(f.repo.read().spentWei).toBe('0'); expect(f.repo.read().reservedWei).toBe(e.maxCostWei)
    expect(f.repo.read().jobs[`execution:${e.hash}`]).toMatchObject({ status: 'blocked', reason: 'receipt_reorg' })
    expect(f.rpc.sent).toEqual([e.raw]); expect(f.sign).toHaveBeenCalledTimes(1)
    await f.keeper.runOnce(); expect(f.rpc.sent).toEqual([e.raw, e.raw]); expect(f.sign).toHaveBeenCalledTimes(1)
  })
  it('fails closed for unknown additional fees or receipt cost above the reservation', async () => {
    const f = setup(); f.rpc.set('operatorFeeScalar', 1)
    await expect(f.keeper.runOnce()).rejects.toThrow('additional_fee_model_changed'); expect(f.sign).not.toHaveBeenCalled()
    f.rpc.set('operatorFeeScalar', 0); f.repo.change(s => { s.cursor = 0 }); await f.keeper.runOnce(); const e = Object.values(f.repo.read().executions)[0]
    f.rpc.receipts.set(e.hash, { ...receipt(e.hash), effectiveGasPrice: '0xffff' })
    await expect(f.keeper.runOnce()).rejects.toThrow('receipt_cost_exceeds_reserve')
    expect(f.repo.read().spentWei).toBe('0'); expect(f.repo.read().reservedWei).toBe(e.maxCostWei)
  })
  it('does not sign on chain 196 or when disabled, regardless of an available signer', async () => {
    const f = setup(); f.rpc.wrongChain = true
    await expect(f.keeper.runOnce()).rejects.toThrow('wrong_chain'); expect(f.sign).not.toHaveBeenCalled()
    f.c.executionEnabled = false; await f.keeper.runOnce(); expect(f.sign).not.toHaveBeenCalled(); expect(f.rpc.sent).toHaveLength(0)
  })
})


describe('live recovery and complete reorg accounting', () => {
  it('checks live deployment roots before rebroadcast but settles an existing receipt even when roots changed', async () => {
    const f = setup(); f.rpc.broadcastFailure = true
    const proof = vi.spyOn(f.discovery, 'verifyBase')
    await f.keeper.runOnce()
    expect(proof).toHaveBeenCalledTimes(1) // Same-event first send reuses only its in-memory Planner proof.
    const e = Object.values(f.repo.read().executions)[0]
    proof.mockRejectedValue(new Error('runtime_binding_changed'))
    await expect(f.keeper.runOnce()).rejects.toThrow('runtime_binding_changed')
    expect(f.rpc.sent).toHaveLength(1); expect(f.sign).toHaveBeenCalledTimes(1)
    f.rpc.receipts.set(e.hash, receipt(e.hash)); await f.keeper.runOnce()
    expect(f.repo.read().spentWei).toBe('21000'); expect(f.repo.read().reservedWei).toBe('0')
  })
  it('requires fresh roots after restart even when a prepared execution has zero broadcasts', async () => {
    const f = setup(), flush = f.repo.flush.bind(f.repo)
    vi.spyOn(f.repo, 'flush').mockImplementation(async () => {
      if (Object.values(f.repo.read().executions).some(e => e.status === 'prepared')) throw new Error('crash_after_prepare')
      await flush()
    })
    await expect(f.keeper.runOnce()).rejects.toThrow('crash_after_prepare')
    const e = Object.values(f.repo.read().executions)[0]
    expect(e.broadcasts).toBe(0); expect(f.rpc.sent).toHaveLength(0)
    const repo = new Repository(f.storage, d)
    vi.spyOn(f.discovery, 'verifyBase').mockRejectedValue(new Error('runtime_binding_changed'))
    const restarted = new Keeper(f.c, d, repo, f.rpc, f.planner, keeperSigner, () => now)
    await expect(restarted.runOnce()).rejects.toThrow('runtime_binding_changed')
    expect(f.rpc.sent).toHaveLength(0); expect(f.sign).toHaveBeenCalledTimes(1)
    expect(repo.read().reservedWei).toBe(e.maxCostWei)
  })
  it('blocks recovery when the operator changes keeper identity, gas ceiling or total cap', async () => {
    const f = setup(); f.rpc.broadcastFailure = true; await f.keeper.runOnce()
    f.c.maxGasPriceWei = 0n
    await expect(f.keeper.runOnce()).rejects.toThrow('execution_policy_changed')
    f.c.maxGasPriceWei = 10n; f.c.gasCapWei = 1n
    await expect(f.keeper.runOnce()).rejects.toThrow('gas_budget_exhausted')
    expect(f.rpc.sent).toHaveLength(1); expect(f.sign).toHaveBeenCalledTimes(1)
  })
  it('recomputes earlier nonce costs when the latest settled block is replaced', async () => {
    const f = setup(); await f.keeper.runOnce()
    const first = Object.values(f.repo.read().executions)[0]
    f.rpc.receipts.set(first.hash, receipt(first.hash)); await f.keeper.runOnce()
    f.rpc.nonce = 1n; f.rpc.pendingNonce = 1n
    f.repo.change(s => { s.cursor = 0 }); await f.keeper.runOnce()
    const second = Object.values(f.repo.read().executions).find(e => e.nonce === 1)!
    f.rpc.receipts.set(second.hash, receipt(second.hash)); await f.keeper.runOnce()
    expect(f.repo.read().spentWei).toBe('42000')
    const changedHash = `0x${'cd'.repeat(32)}` as const, original = f.rpc.request.bind(f.rpc)
    vi.spyOn(f.rpc, 'request').mockImplementation((m, p) => m === 'eth_getBlockByNumber' ? Promise.resolve({ ...header, hash: changedHash, timestamp: '0x3e8' }) : original(m, p))
    f.rpc.receipts.set(first.hash, { ...receipt(first.hash), blockHash: changedHash, gasUsed: '0x61a8' }) // 25,000
    f.rpc.receipts.set(second.hash, { ...receipt(second.hash), blockHash: changedHash })
    await f.keeper.runOnce()
    expect(f.repo.read().spentWei).toBe('46000'); expect(f.repo.read().reservedWei).toBe('0')
    expect(f.sign).toHaveBeenCalledTimes(2); expect(f.rpc.sent).toHaveLength(2)
  })
})

describe('current business limits on raw recovery', () => {
  it('does not rebroadcast a purchase after the approved inventory changes or the listing is cancelled', async () => {
    const { wallet } = await import('./fixture.ts')
    const f = setup(); f.rpc.set('balanceOf', 0n, d.contracts.fab.address)
    f.rpc.set('listingView', [wallet.address, d.contracts.circuits.address, 7n, 100n, 0, true])
    f.rpc.set('ownerOf', wallet.address); f.rpc.set('getApproved', d.contracts.circuitMarket.address); f.rpc.set('isApprovedForAll', false)
    f.rpc.set('getAmountsIn', [1000n, 100n]); f.rpc.broadcastFailure = true; f.repo.change(s => { s.cursor = d.projects.length })
    await f.keeper.runOnce(); expect(f.rpc.sent).toHaveLength(1)
    f.c.policy!.allowedListingIds = []
    await expect(f.keeper.runOnce()).rejects.toThrow('purchase_policy_changed')
    f.c.policy!.allowedListingIds = ['99']; f.rpc.set('listingView', [wallet.address, d.contracts.circuits.address, 7n, 100n, 0, false])
    await expect(f.keeper.runOnce()).rejects.toThrow('purchase_state_changed')
    expect(f.rpc.sent).toHaveLength(1); expect(f.sign).toHaveBeenCalledTimes(1)
  })
  it('does not rebroadcast a conversion outside a tightened input cap or a changed reference minimum', async () => {
    const f = setup(), p = d.projects[0]
    f.rpc.set('balanceOf', 0n, d.contracts.fab.address); f.rpc.set('balanceOf', 1000n, p.token.address)
    f.rpc.set('getAmountsOut', [990n, 1000n]); f.rpc.broadcastFailure = true
    await f.keeper.runOnce(); expect(f.rpc.sent).toHaveLength(1)
    f.c.policy!.maxConversionInputRaw = 999n
    await expect(f.keeper.runOnce()).rejects.toThrow('conversion_policy_changed')
    f.c.policy!.maxConversionInputRaw = 1000n; f.rpc.set('getAmountsOut', [990n, 2000n])
    await expect(f.keeper.runOnce()).rejects.toThrow('conversion_state_changed')
    expect(f.rpc.sent).toHaveLength(1); expect(f.sign).toHaveBeenCalledTimes(1)
  })
})
