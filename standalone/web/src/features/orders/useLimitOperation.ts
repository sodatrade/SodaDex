import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { hashTypedData } from 'viem'
import { orderTypedData, type SodaLimitOrder } from '../../../../order-types'
import { CHAIN_ID } from '../../domain/assets'
import { rpc } from '../../lib/rpc'
import type { WalletController } from '../../lib/useWallet'
import { CONTRACTS } from '../../trading/config'
import { receiptStatus } from '../../trading/receipts'
import { tradeError, TradeError, type TradeIdentity, type TradeErrorCode, type TradeProgress } from '../../trading/types'
import { identityGuard } from '../../trading/walletExecution'
import { readTransactions, recordTransaction, updateTransaction, type SubmittedTransaction } from '../history/journal'
import { getOrder, orderServiceReady, submitOrder, type PublicOrder } from './api'
import type { OrderDeployment } from './config'
import { readOrderSubmissions, saveOrderSubmission, type OrderSubmission } from './OrderJournal'
import { cancelLimitOrder, readOrderChainState, signLimitOrder } from './signing'
export interface LimitReview { order: SodaLimitOrder; identity: TradeIdentity; revision: number }
export function useLimitOperation(wallet: WalletController, deployment: OrderDeployment | undefined, canSubmit: boolean) {
  const ready = useRef(canSubmit); ready.current = canSubmit
  const revision = useRef(0), running = useRef(false), client = useQueryClient()
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState<TradeProgress>(), [error, setError] = useState<TradeErrorCode>()
  const [record, setRecord] = useState<SubmittedTransaction | undefined>(() => readTransactions().find((v) => v.status === 'pending' && ['limit approval', 'limit cancellation'].includes(v.kind)))
  const tx = useRef(record), [confirmed, setConfirmed] = useState(false), [checking, setChecking] = useState(false)
  const [submission, setSubmission] = useState<OrderSubmission | undefined>(() => deployment ? readOrderSubmissions(deployment).find(v => !v.released) : undefined)
  const [result, setResult] = useState<PublicOrder>(), [absent, setAbsent] = useState(false)
  useEffect(() => () => { revision.current += 1 }, [])
  const invalidate = (): void => { void client.invalidateQueries({ queryKey: ['limit-orders'] }); void client.invalidateQueries({ queryKey: ['balances'] }) }
  const saveTx = (value: SubmittedTransaction): void => { tx.current = value; setRecord(value); recordTransaction(value) }
  const current = (review: LimitReview): boolean => {
    const now = wallet.getIdentity()
    return !!now && now.chainId === CHAIN_ID && now.provider === review.identity.provider && now.revision === review.identity.revision && now.address.toLowerCase() === review.identity.address.toLowerCase() && revision.current === review.revision
  }
  const assertReadCurrent = (generation: number, identity: TradeIdentity | undefined): void => {
    const now = wallet.getIdentity()
    if (generation !== revision.current || identity?.revision !== now?.revision || identity?.provider !== now?.provider || identity?.chainId !== now?.chainId || identity?.address !== now?.address) throw new TradeError('tradeIdentityChanged')
  }
  const observe = async (saved: OrderSubmission): Promise<OrderSubmission> => {
    if (!deployment) throw new TradeError('tradeNotReady')
    const generation = revision.current, identity = wallet.getIdentity()
    const recovery = await readOrderChainState(saved.order, deployment).catch(() => { throw new TradeError('tradeUnavailable') })
    assertReadCurrent(generation, identity)
    const next = { ...saved, recovery }
    saveOrderSubmission(next, deployment); setSubmission(next)
    return next
  }
  const hasPending = (): boolean => tx.current?.status === 'pending'
  const execute = async (review: LimitReview, cancel = false): Promise<void> => {
    if (running.current || hasPending() || !deployment || (!cancel && (submission || !ready.current))) return
    running.current = true; setBusy(true); setError(undefined); setConfirmed(false)
    const context = { identity: review.identity, getIdentity: wallet.getIdentity, isCurrentForm: () => revision.current === review.revision && (cancel || ready.current),
      onProgress: (next: TradeProgress): void => {
        const previous = tx.current
        if (previous?.status === 'pending' && next.stage !== 'tradeConfirming') saveTx({ ...previous, status: 'success' })
        if (next.hash && next.to) saveTx({ chainId: CHAIN_ID, hash: next.hash, account: review.identity.address, to: next.to,
          kind: cancel ? 'limit cancellation' : 'limit approval', submittedAt: Date.now(), status: 'pending' })
        setProgress(next)
      } }
    const guard = identityGuard(context)
    try {
      guard()
      if (!cancel && !await orderServiceReady(deployment)) throw new TradeError('tradeNotReady')
      guard()
      if (cancel) {
        await cancelLimitOrder(review.order, deployment, context)
        if (tx.current) saveTx({ ...tx.current, status: 'success' })
        setConfirmed(true); invalidate()
        if (submission && hashTypedData(orderTypedData(review.order, CONTRACTS.permit2)) === submission.id) await observe(submission)
        return
      }
      const signature = await signLimitOrder(review.order, deployment, context)
      guard()
      if (tx.current?.status === 'pending') saveTx({ ...tx.current, status: 'success' })
      if (!await orderServiceReady(deployment)) throw new TradeError('tradeNotReady')
      guard()
      const next = { id: hashTypedData(orderTypedData(review.order, CONTRACTS.permit2)), order: review.order, submittedAt: Date.now() }
      saveOrderSubmission(next, deployment); setSubmission(next); setAbsent(false)
      // From this point a timeout is ambiguous. Never repeat POST or produce another nonce automatically.
      const accepted = await submitOrder(review.order, signature, deployment)
      setResult(accepted); invalidate()
    } catch (cause) {
      const code = tradeError(cause); setError(code)
      if (code === 'tradeReverted' && tx.current?.status === 'pending') saveTx({ ...tx.current, status: 'reverted' })
    } finally { running.current = false; setBusy(false) }
  }
  const querySubmission = async (): Promise<void> => {
    if (!submission || !deployment || checking || busy) return
    setChecking(true); setAbsent(false)
    const generation = revision.current, identity = wallet.getIdentity()
    try { const found = await getOrder(submission.id, deployment); assertReadCurrent(generation, identity); setResult(found); setAbsent(!found); setError(undefined); invalidate() }
    catch (cause) { setError(cause instanceof TradeError ? cause.code : 'tradeUnavailable') } finally { setChecking(false) }
  }
  const recheck = async (): Promise<void> => {
    const pending = tx.current
    if (!pending || busy || checking) return
    setChecking(true)
    try {
      const status = await receiptStatus(rpc, pending.hash, pending.account, pending.to)
      if (status === 'pending') setError('tradePending')
      else {
        saveTx({ ...pending, status: 'success' }); setError(undefined); setConfirmed(pending.kind === 'limit cancellation'); invalidate()
        if (pending.kind === 'limit cancellation' && submission && pending.account.toLowerCase() === submission.order.maker.toLowerCase() && pending.to.toLowerCase() === submission.order.settlement.toLowerCase()) await observe(submission)
      }
    } catch (cause) {
      const code = tradeError(cause); setError(code)
      if (code === 'tradeReverted') { updateTransaction(pending.hash, 'reverted'); saveTx({ ...pending, status: 'reverted' }) }
    } finally { setChecking(false) }
  }
  const chainTerminal = !!submission?.recovery && submission.recovery.status !== 'open'
  const maker = wallet.getIdentity()
  const canCancelSubmission = !!deployment && !!submission && maker?.chainId === CHAIN_ID && maker.address.toLowerCase() === submission.order.maker.toLowerCase()
  const queryChain = async (): Promise<void> => {
    if (!submission || !deployment || busy || checking) return
    setChecking(true); setError(undefined)
    try { await observe(submission) } catch (cause) { setError(tradeError(cause)) } finally { setChecking(false) }
  }
  const newOrder = async (): Promise<void> => {
    if (busy || checking || !submission || !deployment || hasPending()) return
    setChecking(true); setError(undefined)
    const generation = revision.current, identity = wallet.getIdentity()
    try {
      const found = await getOrder(submission.id, deployment)
      assertReadCurrent(generation, identity)
      setResult(found); setAbsent(!found)
      // A fresh acknowledgement releases only local focus. The service still tracks the live order.
      const next = found ? submission : await observe(submission)
      assertReadCurrent(generation, identity)
      if ((!found && next.recovery?.status === 'open') || hasPending()) return
      saveOrderSubmission({ ...next, released: true, releaseSource: found ? 'service' : 'chain' }, deployment)
      revision.current += 1; setSubmission(undefined); setResult(undefined); setConfirmed(false); setAbsent(false)
      tx.current = undefined; setRecord(undefined); setProgress(undefined); invalidate()
    } catch (cause) { setError(cause instanceof TradeError ? cause.code : 'tradeUnavailable') } finally { setChecking(false) }
  }
  return { busy, progress, error, record, confirmed, checking, submission, result, absent,
    unresolved: record?.status === 'pending', current, execute, querySubmission, recheck, queryChain, chainTerminal, canCancelSubmission, newOrder,
    review: (order: SodaLimitOrder, identity: TradeIdentity): LimitReview => { setConfirmed(false); setProgress(undefined); setError(undefined); return { order, identity, revision: revision.current } },
    changed: (): void => { revision.current += 1; setError(undefined) },
  }
}
export type LimitOperation = ReturnType<typeof useLimitOperation>
