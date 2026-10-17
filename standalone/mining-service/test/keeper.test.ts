import { describe, expect, it, vi } from 'vitest'
import { keccak256 } from 'viem'
import { Keeper } from '../src/keeper.ts'
import { Planner } from '../src/planner.ts'
import { Repository } from '../src/repository.ts'
import { fixture, d, now, keeperSigner, signer, header } from './fixture.ts'
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
    f.rpc.simulateFailure = false; f.c.gasCapWei = 1n
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
    f.rpc.receipts.delete(e.hash); f.rpc.broadcastFailure = true; await f.keeper.runOnce()
    expect(f.repo.read().spentWei).toBe('0'); expect(f.repo.read().reservedWei).toBe(e.maxCostWei)
    expect(f.rpc.sent).toEqual([e.raw, e.raw]); expect(f.sign).toHaveBeenCalledTimes(1)
  })
  it('fails closed for unknown additional fees or receipt cost above the reservation', async () => {
    const f = setup(); f.rpc.set('operatorFeeScalar', 1)
    await expect(f.keeper.runOnce()).rejects.toThrow('additional_fee_model_changed'); expect(f.sign).not.toHaveBeenCalled()
    f.rpc.set('operatorFeeScalar', 0); await f.keeper.runOnce(); const e = Object.values(f.repo.read().executions)[0]
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
