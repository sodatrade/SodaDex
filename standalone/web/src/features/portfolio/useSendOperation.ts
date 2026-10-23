import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { CHAIN_ID } from '../../domain/assets'
import { rpc } from '../../lib/rpc'
import type { WalletController } from '../../lib/useWallet'
import { receiptStatus } from '../../trading/receipts'
import { executeTransfer, type TransferRequest } from '../../trading/transfers'
import { tradeError, type TradeErrorCode, type TradeIdentity, type TradeProgress } from '../../trading/types'
import { readTransactions, recordTransaction, type SubmittedTransaction } from '../history/journal'
function pendingSend(account?: string): SubmittedTransaction | undefined {
  return account ? readTransactions(account).find((r) => r.kind === 'send' && r.status === 'pending') : undefined
}
/** A recovered send is only queried by hash; neither confirmation nor recovery resumes it. */
export function useSendOperation(wallet: WalletController) {
  const [record, setRecord] = useState<SubmittedTransaction | undefined>(() => pendingSend(wallet.session?.address))
  const [recovered] = useState(() => !!record)
  const recordRef = useRef(record), revision = useRef(0), inFlight = useRef(false)
  const [progress, setProgress] = useState<TradeProgress>()
  const [error, setError] = useState<TradeErrorCode>()
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false)
  const queryClient = useQueryClient()
  useEffect(() => () => { revision.current += 1 }, [])
  const refresh = (): void => {
    for (const key of ['portfolio-tokens', 'balances', 'dex-events']) void queryClient.invalidateQueries({ queryKey: [key] })
  }
  const save = (value: SubmittedTransaction): void => { recordRef.current = value; setRecord(value); recordTransaction(value) }
  const markReverted = (): void => { if (recordRef.current?.status === 'pending') save({ ...recordRef.current, status: 'reverted' }) }
  const execute = async (request: TransferRequest, identity: TradeIdentity): Promise<void> => {
    if (inFlight.current || recordRef.current?.status === 'pending') return
    inFlight.current = true
    const generation = ++revision.current
    setBusy(true); setError(undefined); setProgress(undefined)
    try {
      await executeTransfer(request, { identity, getIdentity: wallet.getIdentity,
        isCurrentForm: () => revision.current === generation,
        onProgress: (next) => {
          if (next.hash && next.to) save({ chainId: CHAIN_ID, hash: next.hash, account: identity.address,
            to: next.to, kind: 'send', submittedAt: Date.now(), status: next.stage === 'tradeSucceeded' ? 'success' : 'pending' })
          else if (next.stage === 'tradeSucceeded' && recordRef.current) save({ ...recordRef.current, status: 'success' })
          setProgress(next)
        } })
      if (recordRef.current) save({ ...recordRef.current, status: 'success' })
      refresh()
    } catch (cause) {
      const code = tradeError(cause); setError(code)
      if (code === 'tradeReverted') markReverted()
    } finally { inFlight.current = false; setBusy(false) }
  }
  const recheck = async (): Promise<void> => {
    const current = recordRef.current
    if (!current || checking) return
    setChecking(true); setError(undefined)
    try {
      const status = await receiptStatus(rpc, current.hash, current.account, current.to)
      if (status === 'pending') setError('tradePending')
      else { save({ ...current, status: 'success' }); setProgress({ stage: 'tradeSucceeded', hash: current.hash }); refresh() }
    } catch (cause) {
      const code = tradeError(cause); setError(code)
      if (code === 'tradeReverted') save({ ...current, status: 'reverted' })
    } finally { setChecking(false) }
  }
  return { record, recovered, progress, error, busy, checking, pending: record?.status === 'pending',
    done: record?.status === 'success' || progress?.stage === 'tradeSucceeded', execute, recheck,
    cancel: (): void => { revision.current += 1 },
    reset: (): void => { if (!busy && recordRef.current?.status !== 'pending') { setProgress(undefined); setError(undefined); setRecord(undefined); recordRef.current = undefined } },
  }
}
