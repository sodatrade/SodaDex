import { toHex, type TransactionSerializableLegacy } from 'viem'
import type { MiningProductDeployment } from '../../mining-products.ts'
import { block } from './rpc.ts'
import { assertZeroAdditionalFees, serializedBytes } from './fees.ts'
import { validateRaw, validateSaved, validKeeperCall, assertLiveExecution } from './execution-policy.ts'
import { executionReceipt } from './execution-receipt.ts'
import { ExpiredRecovery } from './expired-recovery.ts'
import { Repository } from './repository.ts'
import { Planner } from './planner.ts'
import { quantity, same, ServiceError, type Block, type Execution, type KeeperSigner, type Rpc, type RuntimeConfig } from './types.ts'
export class Keeper {
  constructor(readonly c: RuntimeConfig, readonly d: MiningProductDeployment, readonly repo: Repository, readonly rpc: Rpc,
    readonly planner: Planner, readonly signer?: KeeperSigner, readonly now = (): number => Math.floor(Date.now() / 1000)) {}
  private pending(): Execution | undefined {
    return Object.values(this.repo.read().executions).find(e => ['prepared', 'broadcast', 'nonce_conflict'].includes(e.status))
  }
  private job(e: Execution, status: 'broadcast' | 'confirmed' | 'failed' | 'blocked', reason: string): void {
    if (e.recoveryOf) return // A nonce cancellation is never a successful product operation.
    this.repo.change(s => {
      const j = s.jobs[e.jobId]
      if (j) {
        const next = { ...j, status, reason, hash: e.hash, updatedAt: this.now() * 1000 }
        s.jobs[e.jobId] = next
        // Keep receipt links when the scheduler replaces the live job with a waiting state.
        const id = `execution:${e.hash}`
        s.jobs[id] = { ...next, id }
        const history = Object.values(s.jobs).filter(x => x.id.startsWith('execution:')).toSorted((a, b) => b.updatedAt - a.updatedAt)
        for (const old of history.slice(50)) delete s.jobs[old.id]
      }
    })
  }
  async runOnce(): Promise<void> {
    if (!this.c.executionEnabled || !this.signer || !same(this.signer.address, this.c.keeperAddress ?? '')) return
    if (quantity(await this.rpc.request('eth_chainId')) !== 1952n) throw new ServiceError('wrong_chain', 503)
    // Check the latest finished execution for a reorg before allocating another nonce.
    const finished = Object.values(this.repo.read().executions).filter(e => ['confirmed', 'reverted'].includes(e.status)).toSorted((a, b) => b.nonce - a.nonce)[0]
    if (finished && await this.recheckFinished(finished)) return
    const pending = this.pending()
    if (pending) { await this.recover(pending); return }
    const budget = this.repo.read()
    if (BigInt(budget.spentWei) + BigInt(budget.reservedWei) >= this.c.gasCapWei) throw new ServiceError('gas_budget_exhausted')
    const call = await this.planner.next()
    if (!call) return
    if (!validKeeperCall(call, this.d, Object.values(this.repo.read().projects))) throw new ServiceError('keeper_call_rejected', 503)
    const from = this.signer.address, tx = { from, to: call.to, data: call.data, value: '0x0' }
    await this.rpc.request('eth_call', [tx, 'pending'])
    const estimate = quantity(await this.rpc.request('eth_estimateGas', [tx, 'pending']))
    const gas = (estimate * 120n + 99n) / 100n, gasPrice = quantity(await this.rpc.request('eth_gasPrice'))
    if (gas <= 0n || gas > this.c.maxGasPerTransaction || gasPrice <= 0n || gasPrice > this.c.maxGasPriceWei) throw new ServiceError('transaction_gas_limit')
    const maxCost = gas * gasPrice
    await assertZeroAdditionalFees(this.rpc, (call.data.length - 2) / 2 + 200, gas)
    const observations = await Promise.all([
      this.rpc.request('eth_getTransactionCount', [from, 'latest']),
      this.rpc.request('eth_getTransactionCount', [from, 'pending']),
      this.rpc.request('eth_getBalance', [from, 'latest']),
    ])
    const [latest, next, balance] = observations.map(quantity)
    if (latest !== next || next > BigInt(Number.MAX_SAFE_INTEGER)) throw new ServiceError('keeper_nonce_unresolved')
    const current = this.repo.read()
    if (balance < maxCost || BigInt(current.spentWei) + BigInt(current.reservedWei) + maxCost > this.c.gasCapWei) throw new ServiceError('gas_budget_exhausted')
    if (call.deadline !== undefined && call.deadline <= this.now() + 5) throw new ServiceError('authorization_expiring')
    // A slow simulation/estimate must not knowingly create a new signed row
    // after its EIP-712 lifetime has already elapsed. Broadcast still revalidates.
    if (call.deadline !== undefined) {
      const head = await block(this.rpc)
      if (BigInt(call.deadline) <= head.timestamp + 5n || call.deadline <= this.now() + 5) throw new ServiceError('authorization_expiring')
    }
    const plan: TransactionSerializableLegacy = { type: 'legacy', chainId: 1952, to: call.to, data: call.data, value: 0n, gas, gasPrice, nonce: Number(next) }
    const raw = await this.signer.signTransaction(plan), txHash = await validateRaw(raw, plan, from)
    const e: Execution = { hash: txHash, raw, signer: from, nonce: Number(next), to: call.to, data: call.data,
      gas: String(gas), gasPrice: String(gasPrice), maxCostWei: String(maxCost), jobId: call.jobId,
      status: 'prepared', broadcasts: 0, ...(call.deadline === undefined ? {} : { deadline: call.deadline }) }
    this.repo.change(s => {
      if (Object.values(s.executions).some(v => ['prepared', 'broadcast', 'nonce_conflict'].includes(v.status))) throw new ServiceError('keeper_nonce_unresolved')
      s.reservedWei = String(BigInt(s.reservedWei) + maxCost); s.executions[txHash] = e
      s.jobs[call.jobId] = { id: call.jobId, kind: call.kind, status: 'prepared', reason: 'signed', ...(call.token ? { token: call.token } : {}), hash: txHash, updatedAt: this.now() * 1000 }
    })
    await this.repo.flush()
    await this.recover(e, true, call.verifiedBlock)
  }
  private async recheckFinished(e: Execution): Promise<boolean> {
    const head = await block(this.rpc)
    const canonical = e.receiptBlock && e.receiptBlockHash && BigInt(e.receiptBlock) <= BigInt(head.number) &&
      same((await block(this.rpc, e.receiptBlock)).hash, e.receiptBlockHash)
    if (canonical) return false // This canonical descendant also anchors every earlier settled transaction.
    const finished = Object.values(this.repo.read().executions).filter(x => ['confirmed', 'reverted'].includes(x.status))
    // Restore all affected reserves atomically before any network reads. Earlier nonces can
    // have different gasUsed/status after the same reorg; none of their old costs is final.
    this.repo.change(s => {
      const restored = new Set<string>()
      for (const winner of finished) {
        const linked = winner.recoveryOf ? s.executions[winner.recoveryOf] : winner.cancellationHash ? s.executions[winner.cancellationHash] : undefined
        for (const prior of [winner, linked]) {
          if (!prior || restored.has(prior.hash)) continue
          restored.add(prior.hash)
          s.spentWei = String(BigInt(s.spentWei) - BigInt(prior.actualCostWei ?? '0'))
          s.reservedWei = String(BigInt(s.reservedWei) + BigInt(prior.maxCostWei))
          const restoredExecution: Execution = { ...prior, status: 'broadcast' }
          delete restoredExecution.actualCostWei; delete restoredExecution.receiptBlock; delete restoredExecution.receiptBlockHash; delete restoredExecution.replacementWinner
          s.executions[prior.hash] = restoredExecution
          for (const j of Object.values(s.jobs)) if (j.hash === prior.hash) {
            j.status = 'blocked'; j.reason = 'receipt_reorg'; j.updatedAt = this.now() * 1000
          }
        }
      }
    })
    await this.repo.flush()
    for (const prior of finished) await this.recover({ ...prior, status: 'broadcast' }, false)
    return true
  }
  async recover(e: Execution, allowBroadcast = true, initialProof?: Block): Promise<void> {
    if (e.recoveryOf || e.cancellationHash || same(this.c.expiredRecoveryHash ?? '', e.hash)) {
      if (!this.signer) throw new ServiceError('recovery_scope_rejected')
      const original = e.recoveryOf ? this.repo.read().executions[e.recoveryOf] : e
      if (!original) throw new ServiceError('recovery_link_invalid', 503)
      await new ExpiredRecovery(this.c, this.d, this.repo, this.rpc, this.planner.discovery, this.signer, this.job.bind(this)).run(original, allowBroadcast)
      return
    }
    await validateSaved(e, this.d, Object.values(this.repo.read().projects))
    let receipt
    try { receipt = await executionReceipt(this.rpc, e) } catch (error) {
      if (error instanceof ServiceError && error.code === 'receipt_reorg') { this.job(e, 'blocked', 'receipt_reorg'); return }
      throw error
    }
    if (receipt) {
      this.repo.change(s => {
        const current = s.executions[e.hash]
        if (!['prepared', 'broadcast', 'nonce_conflict'].includes(current.status)) return
        s.reservedWei = String(BigInt(s.reservedWei) - BigInt(e.maxCostWei)); s.spentWei = String(BigInt(s.spentWei) + receipt.cost)
        s.executions[e.hash] = { ...e, status: receipt.status, receiptBlock: receipt.block.number, receiptBlockHash: receipt.block.hash, actualCostWei: String(receipt.cost) }
      })
      this.job(e, receipt.status === 'confirmed' ? 'confirmed' : 'failed', receipt.status === 'confirmed' ? 'settled' : 'transaction_reverted')
      await this.repo.flush(); return
    }
    const [observedNonce, known, observedPendingNonce, balance] = await Promise.all([
      this.rpc.request('eth_getTransactionCount', [e.signer, 'latest']),
      this.rpc.request('eth_getTransactionByHash', [e.hash]),
      this.rpc.request('eth_getTransactionCount', [e.signer, 'pending']),
      this.rpc.request('eth_getBalance', [e.signer, 'latest']),
    ])
    const nonce = quantity(observedNonce)
    if (nonce > BigInt(e.nonce)) {
      this.repo.change(s => { s.executions[e.hash].status = 'nonce_conflict' })
      this.job(e, 'blocked', 'nonce_consumed_unknown'); await this.repo.flush(); return
    }
    if (nonce < BigInt(e.nonce)) { this.job(e, 'blocked', 'nonce_state_unavailable'); return }
    if (known !== null) { this.job(e, 'broadcast', 'pending_confirmation'); return }
    const pendingNonce = quantity(observedPendingNonce)
    if (pendingNonce !== nonce) { this.job(e, 'blocked', 'pending_nonce_unknown'); return }
    if (e.deadline !== undefined && e.deadline <= this.now() + 5) { this.job(e, 'blocked', 'authorization_expired'); return }
    if (!allowBroadcast) { this.job(e, 'blocked', 'receipt_reorg'); return }
    if (!this.c.executionEnabled || BigInt(this.repo.read().spentWei) + BigInt(this.repo.read().reservedWei) > this.c.gasCapWei) throw new ServiceError('gas_budget_exhausted')
    await assertLiveExecution(e, this.c, this.d, this.rpc, this.planner.discovery, Object.values(this.repo.read().projects), initialProof)
    if (quantity(balance) < BigInt(e.maxCostWei)) throw new ServiceError('keeper_balance_insufficient')
    // An unknown broadcast is reconciled by this exact hash; at most one identical rebroadcast.
    if (e.broadcasts >= 2) { this.job(e, 'blocked', 'broadcast_unknown'); return }
    await this.rpc.request('eth_call', [{ from: e.signer, to: e.to, data: e.data, value: toHex(0n) }, 'pending'])
    await assertZeroAdditionalFees(this.rpc, serializedBytes(e.raw), BigInt(e.gas))
    this.repo.change(s => { s.executions[e.hash].status = 'broadcast'; s.executions[e.hash].broadcasts++ })
    await this.repo.flush()
    try {
      const result = await this.rpc.request('eth_sendRawTransaction', [e.raw])
      if (result !== e.hash) throw new ServiceError('broadcast_unknown', 503)
      this.job(e, 'broadcast', 'pending_confirmation')
    } catch { this.job(e, 'broadcast', 'broadcast_unknown') }
    await this.repo.flush()
  }
}
