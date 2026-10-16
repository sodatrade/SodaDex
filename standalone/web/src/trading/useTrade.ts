import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { CHAIN_ID } from '../domain/assets'
import { recordTransaction, updateTransaction } from '../features/history/journal'
import { rpc } from '../lib/rpc'
import type { WalletController } from '../lib/useWallet'
import { executeTrade } from './execution'
import { receiptStatus } from './receipts'
import {
  tradeError,
  TradeError,
  type Quote,
  type TradeErrorCode,
  type TradeIdentity,
  type TradeProgress,
} from './types'

export function useTrade(wallet: WalletController, formRevision: { current: number }) {
  const [progress, setProgress] = useState<TradeProgress>()
  const [lastSubmitted, setLastSubmitted] = useState<TradeProgress>()
  const [error, setError] = useState<TradeErrorCode>()
  const [checking, setChecking] = useState(false)
  const run = useRef(0)
  const submittedIdentity = useRef<TradeIdentity | undefined>(undefined)
  const queryClient = useQueryClient()
  useEffect(
    () => () => {
      run.current += 1
    },
    [],
  )
  const mutation = useMutation({
    retry: false,
    mutationFn: async ({ quote, identity }: { quote: Quote; identity: TradeIdentity }) => {
      if (!identity) throw new TradeError('tradeIdentityChanged')
      submittedIdentity.current = identity
      const currentRun = ++run.current
      const revision = formRevision.current
      setError(undefined)
      return executeTrade(quote, {
        identity,
        getIdentity: wallet.getIdentity,
        isCurrentForm: () => run.current === currentRun && formRevision.current === revision,
        onProgress: (next) => {
          if (next.hash) {
            setLastSubmitted(next)
            if (next.to) recordTransaction({ chainId: CHAIN_ID, hash: next.hash, account: identity.address,
              to: next.to, kind: next.kind ?? 'swap', submittedAt: Date.now(), status: 'pending' })
            if (next.stage === 'tradeSucceeded') updateTransaction(next.hash, 'success')
          }
          setProgress(next)
        },
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['balances'] })
    },
    onError: (cause) => {
      setError(tradeError(cause))
    },
  })
  const unresolved = progress?.stage === 'tradeConfirming' && !!progress.hash
  const recheck = async (): Promise<void> => {
    const identity = submittedIdentity.current
    if (!identity || !progress?.hash || !progress.to) return
    setChecking(true)
    try {
      const status = await receiptStatus(rpc, progress.hash, identity.address, progress.to)
      if (status === 'pending') setError('tradePending')
      else {
        updateTransaction(progress.hash, 'success')
        setError(progress.kind === 'approval' ? 'tradeReviewAgain' : undefined)
        setProgress({
          ...progress,
          stage: progress.kind === 'swap' ? 'tradeSucceeded' : 'tradePreparing',
          hash: progress.kind === 'swap' ? progress.hash : undefined,
        })
        void queryClient.invalidateQueries({ queryKey: ['balances'] })
      }
    } catch (cause) {
      const code = tradeError(cause)
      setError(code)
      // A proven onchain revert is terminal; transport failure keeps the submitted hash locked.
      if (code === 'tradeReverted') {
        updateTransaction(progress.hash, 'reverted')
        setProgress({ ...progress, stage: 'tradePreparing' })
      }
    } finally {
      setChecking(false)
    }
  }
  return {
    progress,
    lastSubmitted,
    error,
    checking,
    unresolved,
    busy: mutation.isPending,
    execute: (quote: Quote, identity: TradeIdentity) => {
      if (!mutation.isPending && !unresolved) mutation.mutate({ quote, identity })
    },
    cancel: () => {
      run.current += 1
    },
    recheck,
    reset: () => {
      if (!mutation.isPending && !unresolved) {
        setProgress(undefined)
        setError(undefined)
      }
    },
  }
}
