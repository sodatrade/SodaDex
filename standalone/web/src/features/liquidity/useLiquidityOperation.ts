import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { rpc } from '../../lib/rpc'
import type { WalletController } from '../../lib/useWallet'
import type { WalletIdentity } from '../../lib/wallet'
import { executeLiquidity, liquidityError, prepareLiquidity, recheckLiquidityReceipt } from '../../liquidity'
import type { LiquidityErrorCode, LiquidityOperation, LiquidityPreview, LiquidityProgress } from '../../liquidity/types'
import { LiquidityError } from '../../liquidity/types'
import { readRecord, writeRecord, type LiquidityRecord } from './transactionRecord'

export interface LiquidityOperationController {
  review?: { preview: LiquidityPreview; identity: WalletIdentity }
  error?: LiquidityErrorCode
  progress?: LiquidityProgress
  record?: LiquidityRecord
  recovered: boolean
  storageFailed: boolean
  receiptMessage?: 'receiptConfirmed' | 'receiptReverted' | 'pending'
  checking: boolean
  preparing: boolean
  executing: boolean
  blocked: boolean
  prepare: (operation: LiquidityOperation) => void
  confirm: () => void
  closeReview: () => void
  cancel: () => void
  recheck: () => Promise<void>
  refresh: () => void
}
export function useLiquidityOperation(wallet: WalletController): LiquidityOperationController {
  const [review, setReview] = useState<{ preview: LiquidityPreview; identity: WalletIdentity }>()
  const [error, setError] = useState<LiquidityErrorCode>()
  const [progress, setProgress] = useState<LiquidityProgress>()
  const [record, setRecord] = useState<LiquidityRecord | undefined>(readRecord)
  const [recovered] = useState(() => !!readRecord())
  const [storageFailed, setStorageFailed] = useState(false)
  const [receiptMessage, setReceiptMessage] = useState<'receiptConfirmed' | 'receiptReverted' | 'pending'>()
  const [checking, setChecking] = useState(false)
  const revision = useRef(0)
  useEffect(
    () => () => {
      revision.current += 1
    },
    [],
  )
  const recordRef = useRef(record)
  const queryClient = useQueryClient()
  const save = (value: LiquidityRecord): void => {
    recordRef.current = value
    setRecord(value)
    if (!writeRecord(value)) setStorageFailed(true)
  }
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['liquidity'] })
    void queryClient.invalidateQueries({ queryKey: ['balances'] })
  }
  const preparation = useMutation({
    retry: false,
    mutationFn: async (operation: LiquidityOperation) => {
      const identity = wallet.getIdentity(),
        generation = ++revision.current
      if (!identity || identity.chainId !== 196) throw new LiquidityError('identityChanged')
      setError(undefined)
      setProgress(undefined)
      setReceiptMessage(undefined)
      const preview = await prepareLiquidity(operation, identity.address)
      if (generation !== revision.current || wallet.getIdentity()?.revision !== identity.revision)
        throw new LiquidityError('identityChanged')
      setReview({ preview, identity })
    },
    onError: (cause) => setError(liquidityError(cause)),
  })
  const execution = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!review) throw new LiquidityError('failed')
      const generation = revision.current
      setError(undefined)
      return executeLiquidity(review.preview, {
        identity: review.identity,
        getIdentity: wallet.getIdentity,
        isCurrentForm: () => generation === revision.current,
        onProgress: (next) => {
          const current = recordRef.current
          if (next.hash && next.to && next.kind)
            save({
              chainId: 196,
              hash: next.hash,
              to: next.to,
              from: review.identity.address,
              protocol: review.preview.pool.protocol,
              kind: next.kind,
              status: next.stage === 'success' ? 'success' : 'pending',
            })
          else if (current?.status === 'pending' && next.stage !== 'pending') save({ ...current, status: 'success' })
          setProgress(next)
        },
      })
    },
    onSuccess: () => {
      const current = recordRef.current
      if (current) save({ ...current, status: 'success' })
      refresh()
    },
    onError: (cause) => {
      const code = liquidityError(cause)
      setError(code)
      if (code === 'reverted') {
        setProgress(undefined)
        if (recordRef.current?.status === 'pending') save({ ...recordRef.current, status: 'reverted' })
      }
    },
  })
  const recheck = async (): Promise<void> => {
    const current = recordRef.current
    if (!current) return
    setChecking(true)
    try {
      const status = await recheckLiquidityReceipt(rpc, current.hash, current.from, current.to)
      setError(undefined)
      if (status === 'pending') setReceiptMessage('pending')
      else {
        save({ ...current, status: 'success' })
        setReceiptMessage('receiptConfirmed')
        setProgress(
          current.kind === 'liquidity'
            ? { stage: 'success', hash: current.hash, to: current.to, kind: current.kind }
            : undefined,
        )
        setReview(undefined)
        refresh()
      }
    } catch (cause) {
      const code = liquidityError(cause)
      if (code === 'reverted') {
        save({ ...current, status: 'reverted' })
        setReceiptMessage('receiptReverted')
        setError(undefined)
        setProgress(undefined)
        setReview(undefined)
      } else setError(code)
    } finally {
      setChecking(false)
    }
  }
  const blocked = record?.status === 'pending'
  return {
    review,
    error,
    progress,
    record,
    recovered,
    storageFailed,
    receiptMessage,
    checking,
    preparing: preparation.isPending,
    executing: execution.isPending,
    blocked,
    prepare: (operation: LiquidityOperation) => {
      if (!preparation.isPending && !execution.isPending && !blocked) preparation.mutate(operation)
    },
    confirm: () => {
      if (!execution.isPending && !blocked) execution.mutate()
    },
    closeReview: () => {
      revision.current += 1
      setReview(undefined)
    },
    cancel: () => {
      revision.current += 1
    },
    recheck,
    refresh,
  }
}
