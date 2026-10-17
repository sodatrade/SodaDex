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
import { cancelLimitOrder, signLimitOrder } from './signing'
export interface LimitReview { order: SodaLimitOrder; identity: TradeIdentity; revision: number }
export function useLimitOperation(wallet: WalletController, deployment: OrderDeployment | undefined, canSubmit: boolean) {
  const ready = useRef(canSubmit); ready.current = canSubmit
  const revision = useRef(0), running = useRef(false), client = useQueryClient()
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState<TradeProgress>(), [error, setError] = useState<TradeErrorCode>()
  const [record, setRecord] = useState<SubmittedTransaction | undefined>(() => readTransactions().find((v) => v.status === 'pending' && ['limit approval', 'limit cancellation'].includes(v.kind)))
  const tx = useRef(record), [confirmed, setConfirmed] = useState(false), [checking, setChecking] = useState(false)
  const [submission, setSubmission] = useState<OrderSubmission | undefined>(() => deployment ? readOrderSubmissions(deployment)[0] : undefined)
  const [result, setResult] = useState<PublicOrder>(), [absent, setAbsent] = useState(false)
  useEffect(() => () => { revision.current += 1 }, [])
  const invalidate = (): void => { void client.invalidateQueries({ queryKey: ['limit-orders'] }); void client.invalidateQueries({ queryKey: ['balances'] }) }
  const saveTx = (value: SubmittedTransaction): void => { tx.current = value; setRecord(value); recordTransaction(value) }
  const current = (review: LimitReview): boolean => {
    const now = wallet.getIdentity()
    return !!now && now.chainId === CHAIN_ID && now.provider === review.identity.provider && now.revision === review.identity.revision && now.address.toLowerCase() === review.identity.address.toLowerCase() && revision.current === review.revision
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
        setConfirmed(true); invalidate(); return
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
    try { const found = await getOrder(submission.id, deployment); setResult(found); setAbsent(!found); setError(undefined); invalidate() }
    catch { setError('tradeUnavailable') } finally { setChecking(false) }
  }
  const recheck = async (): Promise<void> => {
    const pending = tx.current
    if (!pending || busy || checking) return
    setChecking(true)
    try {
      const status = await receiptStatus(rpc, pending.hash, pending.account, pending.to)
      if (status === 'pending') setError('tradePending')
      else { saveTx({ ...pending, status: 'success' }); setError(undefined); setConfirmed(pending.kind === 'limit cancellation'); invalidate() }
    } catch (cause) {
      const code = tradeError(cause); setError(code)
      if (code === 'tradeReverted') { updateTransaction(pending.hash, 'reverted'); saveTx({ ...pending, status: 'reverted' }) }
    } finally { setChecking(false) }
  }
  return { busy, progress, error, record, confirmed, checking, submission, result, absent,
    unresolved: record?.status === 'pending', current, execute, querySubmission, recheck,
    review: (order: SodaLimitOrder, identity: TradeIdentity): LimitReview => { setConfirmed(false); setProgress(undefined); setError(undefined); return { order, identity, revision: revision.current } },
    newOrder: (): void => { if (!busy && result && tx.current?.status !== 'pending') { revision.current += 1; setSubmission(undefined); setResult(undefined); setError(undefined); setConfirmed(false) } },
    changed: (): void => { revision.current += 1; setError(undefined) },
  }
}
export type LimitOperation = ReturnType<typeof useLimitOperation>
