import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { CHAIN_ID } from '../../domain/assets'
import { rpc } from '../../lib/rpc'
import type { WalletController } from '../../lib/useWallet'
import { executePoolTrade, type PoolTradeQuote } from '../../trading/poolTrade'
import { executeWrap, type WrapRequest } from '../../trading/wrapping'
import { receiptStatus } from '../../trading/receipts'
import { tradeError, TradeError, type TradeErrorCode, type TradeIdentity, type TradeProgress } from '../../trading/types'
import { readTransactions, recordTransaction, updateTransaction, type SubmittedTransaction } from '../history/journal'
export type SwapReview = { kind: 'pool'; quote: PoolTradeQuote } | { kind: 'wrap'; request: WrapRequest }
const swapKinds = ['swap', 'wrap', 'unwrap', 'swap approval']
function recoveredRecord(): SubmittedTransaction | undefined {
  return readTransactions().find((r) => r.status === 'pending' && swapKinds.includes(r.kind))
}
/** Only wallet-confirmed writes enter the journal; recovery checks receipts and never resumes signing. */
export function useSwapOperation(wallet: WalletController) {
  const [progress, setProgress] = useState<TradeProgress>()
  const [record, setRecord] = useState<SubmittedTransaction | undefined>(recoveredRecord)
  const recordRef = useRef(record)
  const [recovered] = useState(() => !!record)
  const [error, setError] = useState<TradeErrorCode>()
  const [checking, setChecking] = useState(false)
  const [receiptMessage, setReceiptMessage] = useState<'confirmed' | 'approveConfirmed'>()
  const revision = useRef(0), queryClient = useQueryClient()
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['balances'] })
    void queryClient.invalidateQueries({ queryKey: ['swap'] })
    void queryClient.invalidateQueries({ queryKey: ['liquidity'] })
  }
  const save = (next: SubmittedTransaction): void => {
    recordRef.current = next
    setRecord(next)
    recordTransaction(next)
  }
  useEffect(() => () => { revision.current += 1 }, [])
  const execution = useMutation({
    retry: false,
    mutationFn: async ({ review, identity }: { review: SwapReview; identity: TradeIdentity }) => {
      if (recordRef.current?.status === 'pending') throw new TradeError('tradePending')
      const generation = ++revision.current
      setError(undefined); setReceiptMessage(undefined); setProgress(undefined)
      const context = {
        identity, getIdentity: wallet.getIdentity, isCurrentForm: () => revision.current === generation,
        onProgress: (next: TradeProgress): void => {
          const current = recordRef.current
          if (current?.status === 'pending' && next.stage !== 'tradeConfirming') save({ ...current, status: 'success' })
          if (next.hash && next.to) save({ chainId: CHAIN_ID, hash: next.hash, account: identity.address, to: next.to,
            kind: next.kind === 'approval' ? 'swap approval' : review.kind === 'wrap' ? review.request.direction : 'swap',
            submittedAt: Date.now(), status: next.stage === 'tradeSucceeded' ? 'success' : 'pending' })
          else if (next.hash && next.stage === 'tradeSucceeded') updateTransaction(next.hash, 'success')
          setProgress(next)
        },
      }
      return review.kind === 'pool' ? executePoolTrade(review.quote, context) : executeWrap(review.request, context)
    },
    onSuccess: () => { if (recordRef.current) save({ ...recordRef.current, status: 'success' }); refresh() },
    onError: (cause) => {
      const code = tradeError(cause)
      setError(code)
      if (code === 'tradeReverted' && recordRef.current?.status === 'pending') save({ ...recordRef.current, status: 'reverted' })
    },
  })
  const recheck = async (): Promise<void> => {
    const current = recordRef.current
    if (!current) return
    setChecking(true)
    try {
      const status = await receiptStatus(rpc, current.hash, current.account, current.to)
      if (status === 'pending') setError('tradePending')
      else {
        save({ ...current, status: 'success' }); setError(undefined)
        setReceiptMessage(current.kind === 'swap approval' ? 'approveConfirmed' : 'confirmed'); refresh()
      }
    } catch (cause) {
      const code = tradeError(cause); setError(code)
      if (code === 'tradeReverted') save({ ...current, status: 'reverted' })
    } finally { setChecking(false) }
  }
  return {
    progress, record, recovered, error, checking, receiptMessage, busy: execution.isPending,
    unresolved: record?.status === 'pending', recheck,
    execute: (review: SwapReview, identity: TradeIdentity): void => { if (!execution.isPending && recordRef.current?.status !== 'pending') execution.mutate({ review, identity }) },
    cancel: (): void => { revision.current += 1 },
    reset: (): void => { if (!execution.isPending && recordRef.current?.status !== 'pending') { setProgress(undefined); setError(undefined); setReceiptMessage(undefined) } },
  }
}
