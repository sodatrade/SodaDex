import { decodeFunctionData, parseAbi, parseTransaction, recoverTypedDataAddress, type Hex } from 'viem'
import { MINING_CONVERSION_PARAMS_ABI, MINING_PRODUCT_WRITE_ABI } from '../../mining-abi.ts'
import type { MiningProductDeployment } from '../../mining-products.ts'
import type { MiningConversion } from '../../mining-signed-calls.ts'
import { executionReceipt } from './execution-receipt.ts'
import { validateRaw, validateSaved } from './execution-policy.ts'
import { assertZeroAdditionalFees, serializedBytes } from './fees.ts'
import { assertCanonical, read } from './rpc.ts'
import { authorizationDigest, conversionTyped } from './signatures.ts'
import { Repository } from './repository.ts'
import { quantity, same, ServiceError, type Block, type Discovery, type Execution, type KeeperSigner, type Rpc, type RuntimeConfig } from './types.ts'
const CANCELLATION_PRICE = 30_000_000n
export type ExecutionJob = (e: Execution, status: 'broadcast' | 'confirmed' | 'failed' | 'blocked', reason: string) => void
/** Only the operator-configured, exact saved hash can enter this cancellation state machine. */
export class ExpiredRecovery {
  constructor(readonly c: RuntimeConfig, readonly d: MiningProductDeployment, readonly repo: Repository, readonly rpc: Rpc,
    readonly discovery: Discovery, readonly signer: KeeperSigner, readonly job: ExecutionJob) {}
  async validateCancellation(cancel: Execution, original: Execution): Promise<void> {
    if (!same(cancel.recoveryOf ?? '', original.hash) || !same(original.cancellationHash ?? '', cancel.hash) ||
        cancel.nonce !== original.nonce || !same(cancel.signer, original.signer) || !same(cancel.to, original.signer) || cancel.data !== '0x' ||
        BigInt(cancel.gasPrice) !== CANCELLATION_PRICE || BigInt(cancel.maxCostWei) !== BigInt(cancel.gas) * CANCELLATION_PRICE) throw new ServiceError('cancellation_transaction_invalid', 503)
    try {
      const tx = parseTransaction(cancel.raw)
      if ((tx.data ?? '0x') !== '0x' || (tx.value ?? 0n) !== 0n || await validateRaw(cancel.raw, {
        type: 'legacy', chainId: 1952, to: original.signer, data: tx.data, value: 0n,
        nonce: original.nonce, gas: BigInt(cancel.gas), gasPrice: CANCELLATION_PRICE,
      }, original.signer) !== cancel.hash) throw new Error('invalid')
    } catch { throw new ServiceError('cancellation_transaction_invalid', 503) }
  }
  private async proveExpiry(original: Execution): Promise<Block> {
    const projects = Object.values(this.repo.read().projects)
    await validateSaved(original, this.d, projects)
    const decoded = decodeFunctionData({ abi: parseAbi(MINING_PRODUCT_WRITE_ABI.projectVault), data: original.data })
    if (decoded.functionName !== 'convertTax') throw new ServiceError('recovery_scope_rejected')
    const [p, signature] = decoded.args as unknown as [MiningConversion, Hex]
    if (!Number.isSafeInteger(original.deadline) || BigInt(original.deadline!) !== p.deadline) throw new ServiceError('recovery_deadline_mismatch')
    const b = await this.discovery.verifyBase(this.rpc, this.d, this.c.expectedSigner)
    const project = projects.find(v => same(v.vault.address, original.to))
    if (!project) throw new ServiceError('project_not_registered')
    // resolveProject proves the pinned runtime/implementation whose convertTax enforces this deadline.
    const verified = await this.discovery.resolveProject(this.rpc, this.d, project.token.address, this.c.expectedSigner, b)
    if (!same(verified.vault.address, original.to) || !same(verified.vault.runtimeKeccak256, project.vault.runtimeKeccak256)) throw new ServiceError('project_binding_invalid', 503)
    if (b.timestamp <= p.deadline) throw new ServiceError('recovery_authorization_active')
    const typed = conversionTyped(original.to, p)
    const [digest, used, code] = await Promise.all([
      read<Hex>(this.rpc, original.to, `function conversionDigest(${MINING_CONVERSION_PARAMS_ABI} p) view returns(bytes32)`, [p], b.number),
      read<boolean>(this.rpc, original.to, 'function usedConversionNonce(uint256) view returns(bool)', [p.nonce], b.number),
      this.rpc.request('eth_getCode', [original.signer, b.number]),
    ])
    if (digest !== authorizationDigest(typed) || !same(await recoverTypedDataAddress({ ...typed, signature }), this.c.expectedSigner)) throw new ServiceError('recovery_authorization_invalid')
    if (used) throw new ServiceError('recovery_authorization_used')
    if (code !== '0x') throw new ServiceError('recovery_keeper_has_code')
    await assertCanonical(this.rpc, b)
    return b
  }
  async run(original: Execution, allowBroadcast = true): Promise<void> {
    if (quantity(await this.rpc.request('eth_chainId')) !== 1952n || this.c.chainId !== 1952) throw new ServiceError('wrong_chain', 503)
    if (!this.c.executionEnabled || !same(this.c.expiredRecoveryHash ?? '', original.hash) ||
        !same(this.c.keeperAddress ?? '', original.signer) || !same(this.signer.address, original.signer)) throw new ServiceError('recovery_scope_rejected')
    await validateSaved(original, this.d, Object.values(this.repo.read().projects))
    let cancel = original.cancellationHash ? this.repo.read().executions[original.cancellationHash] : undefined
    if (original.cancellationHash && !cancel) throw new ServiceError('recovery_link_invalid', 503)
    if (cancel) await this.validateCancellation(cancel, original)
    // Check both hashes before nonce state: either original or cancellation can win the same nonce.
    const [priorReceipt, cancelReceipt] = await Promise.all([executionReceipt(this.rpc, original), cancel ? executionReceipt(this.rpc, cancel) : undefined])
    if (priorReceipt && cancelReceipt) throw new ServiceError('recovery_winner_conflict', 503)
    const winner = priorReceipt ? original : cancelReceipt ? cancel : undefined
    const receipt = priorReceipt ?? cancelReceipt
    if (winner && receipt) {
      this.repo.change(s => {
        if (!['prepared', 'broadcast', 'nonce_conflict'].includes(s.executions[winner.hash].status)) return
        for (const e of [original, cancel]) if (e) {
          if (!['prepared', 'broadcast', 'nonce_conflict'].includes(s.executions[e.hash].status)) throw new ServiceError('recovery_link_invalid', 503)
          s.reservedWei = String(BigInt(s.reservedWei) - BigInt(e.maxCostWei))
          const clean = { ...e }
          delete clean.actualCostWei; delete clean.receiptBlock; delete clean.receiptBlockHash; delete clean.replacementWinner
          s.executions[e.hash] = e.hash === winner.hash ? { ...clean, status: receipt.status, actualCostWei: String(receipt.cost), receiptBlock: receipt.block.number, receiptBlockHash: receipt.block.hash } : { ...clean, status: 'replaced', replacementWinner: winner.hash }
        }
        s.spentWei = String(BigInt(s.spentWei) + receipt.cost)
      })
      this.job(original, priorReceipt ? receipt.status === 'confirmed' ? 'confirmed' : 'failed' : 'failed', priorReceipt ? receipt.status === 'confirmed' ? 'settled' : 'transaction_reverted' : 'authorization_cancelled')
      await this.repo.flush(); return
    }
    const [latestValue, pendingValue, knownOriginal, knownCancel, balanceValue] = await Promise.all([
      this.rpc.request('eth_getTransactionCount', [original.signer, 'latest']),
      this.rpc.request('eth_getTransactionCount', [original.signer, 'pending']),
      this.rpc.request('eth_getTransactionByHash', [original.hash]),
      cancel ? this.rpc.request('eth_getTransactionByHash', [cancel.hash]) : null,
      this.rpc.request('eth_getBalance', [original.signer, 'latest']),
    ])
    const latest = quantity(latestValue), pending = quantity(pendingValue)
    if (latest !== BigInt(original.nonce)) { this.job(original, 'blocked', latest > BigInt(original.nonce) ? 'nonce_consumed_unknown' : 'nonce_state_unavailable'); await this.repo.flush(); return }
    if (knownOriginal !== null || knownCancel !== null) { this.job(original, 'blocked', 'recovery_pending_confirmation'); await this.repo.flush(); return }
    if (pending !== latest) { this.job(original, 'blocked', 'pending_nonce_unknown'); await this.repo.flush(); return }
    if (!allowBroadcast) { this.job(original, 'blocked', 'receipt_reorg'); await this.repo.flush(); return }
    if (this.c.maxGasPriceWei !== CANCELLATION_PRICE || BigInt(original.gasPrice) * 110n >= CANCELLATION_PRICE * 100n) throw new ServiceError('cancellation_price_unavailable')
    const expiryProof = await this.proveExpiry(original)
    if (!cancel) {
      const tx = { from: original.signer, to: original.signer, value: '0x0', data: '0x' }
      // The shared pending transport intentionally rejects empty-code recipients. This
      // exact EOA/zero-value/empty-data cancellation instead simulates at the proved
      // canonical empty-code block; business calls retain their strict pending probe.
      await this.rpc.request('eth_call', [tx, expiryProof.number])
      const estimate = quantity(await this.rpc.request('eth_estimateGas', [tx, expiryProof.number])), gas = (estimate * 120n + 99n) / 100n
      if (gas <= 0n || gas > this.c.maxGasPerTransaction) throw new ServiceError('transaction_gas_limit')
      const maxCost = gas * CANCELLATION_PRICE, state = this.repo.read()
      if (quantity(balanceValue) < maxCost || BigInt(state.spentWei) + BigInt(state.reservedWei) + maxCost > this.c.gasCapWei) throw new ServiceError('gas_budget_exhausted')
      await assertZeroAdditionalFees(this.rpc, 200, gas)
      const plan = { type: 'legacy' as const, chainId: 1952, to: original.signer, value: 0n, nonce: original.nonce, gas, gasPrice: CANCELLATION_PRICE }
      const raw = await this.signer.signTransaction(plan), hash = await validateRaw(raw, plan, original.signer)
      cancel = { ...original, hash, raw, to: original.signer, data: '0x', gas: String(gas), gasPrice: String(CANCELLATION_PRICE), maxCostWei: String(maxCost),
        jobId: `recovery:${original.hash}`, status: 'prepared', broadcasts: 0, recoveryOf: original.hash }
      delete cancel.deadline; delete cancel.cancellationHash
      const prepared = cancel
      this.repo.change(s => {
        if (s.executions[original.hash].cancellationHash || Object.values(s.executions).some(e => e.recoveryOf === original.hash)) throw new ServiceError('recovery_already_prepared')
        s.executions[original.hash].cancellationHash = prepared.hash; s.executions[prepared.hash] = prepared
        s.reservedWei = String(BigInt(s.reservedWei) + maxCost)
        // Cancellation remains private execution metadata, never a falsely successful conversion job.
      })
      await this.repo.flush()
    }
    if (BigInt(cancel.gas) > this.c.maxGasPerTransaction || BigInt(this.repo.read().spentWei) + BigInt(this.repo.read().reservedWei) > this.c.gasCapWei) throw new ServiceError('gas_budget_exhausted')
    if (quantity(balanceValue) < BigInt(cancel.maxCostWei)) throw new ServiceError('keeper_balance_insufficient')
    if (cancel.broadcasts >= 2) { this.job(original, 'blocked', 'nonce_cancellation_broadcast_unknown'); await this.repo.flush(); return }
    // The proof is repeated on restart, never reconstructed from saved wall-clock metadata.
    await assertZeroAdditionalFees(this.rpc, serializedBytes(cancel.raw), BigInt(cancel.gas))
    await assertCanonical(this.rpc, expiryProof)
    const e = cancel
    this.repo.change(s => { s.executions[e.hash].status = 'broadcast'; s.executions[e.hash].broadcasts++ })
    await this.repo.flush()
    try {
      if (await this.rpc.request('eth_sendRawTransaction', [e.raw]) !== e.hash) throw new ServiceError('broadcast_unknown', 503)
      this.job(original, 'blocked', 'nonce_cancellation_pending')
    } catch { this.job(original, 'blocked', 'nonce_cancellation_broadcast_unknown') }
    await this.repo.flush()
  }
}
