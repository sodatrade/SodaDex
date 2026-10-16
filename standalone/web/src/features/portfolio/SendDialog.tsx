import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { formatUnits, isAddress, zeroAddress } from 'viem'
import { Dialog } from '../../components/Dialog'
import { Button, Icon } from '../../components/primitives'
import { amountError, parseAmount } from '../../domain/amount'
import { CHAIN_ID, EXPLORER_URL } from '../../domain/assets'
import { workspaceMessages } from '../../i18n/workspace'
import { hexQuantity, rpc } from '../../lib/rpc'
import type { WalletController } from '../../lib/useWallet'
import { usePreferences } from '../../preferences/context'
import { receiptStatus } from '../../trading/receipts'
import { buildTransfer, executeTransfer, type TransferRequest } from '../../trading/transfers'
import { tradeError, type TradeErrorCode, type TradeIdentity, type TradeProgress } from '../../trading/types'
import { readTransactions, recordTransaction, updateTransaction, type SubmittedTransaction } from '../history/journal'
import type { PortfolioToken } from './usePortfolioTokens'

export function SendDialog({ token, wallet, onClose }: { token: PortfolioToken; wallet: WalletController; onClose: () => void }): ReactElement {
  const { locale, t } = usePreferences(), m = workspaceMessages(locale), queryClient = useQueryClient()
  const [recipient, setRecipient] = useState(''), [amount, setAmount] = useState('')
  const [review, setReview] = useState<{ request: TransferRequest; identity: TradeIdentity }>()
  const [progress, setProgress] = useState<TradeProgress>()
  const [submitted, setSubmitted] = useState<SubmittedTransaction | undefined>(() => readTransactions(wallet.session?.address).find(r => r.kind === 'send' && r.status === 'pending'))
  const [error, setError] = useState<TradeErrorCode>(), [busy, setBusy] = useState(false), [checking, setChecking] = useState(false)
  const revision = useRef(0)
  useEffect(() => () => { revision.current += 1 }, [])
  const parsed = parseAmount(amount, token.currency.decimals)
  const validRecipient = isAddress(recipient) && recipient.toLowerCase() !== zeroAddress
  const validAmount = parsed.kind === 'valid' && !amountError(amount, token.balance, token.currency.decimals)
  const current = !!review && wallet.getIdentity()?.revision === review.identity.revision
  const gas = useQuery({ queryKey: ['send-gas', review?.identity.address, review?.request.recipient, review?.request.amount.toString(), token.currency.address],
    enabled: !!review && current && !submitted, retry: false,
    queryFn: async () => {
      const tx = buildTransfer(review!.request, review!.identity.address)
      const [units, price] = await Promise.all([rpc('eth_estimateGas', [tx]), rpc('eth_gasPrice')])
      return hexQuantity(units) * hexQuantity(price)
    } })
  const changed = (): void => { revision.current += 1; setReview(undefined); setError(undefined) }
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['portfolio-tokens'] })
    void queryClient.invalidateQueries({ queryKey: ['balances'] })
    void queryClient.invalidateQueries({ queryKey: ['dex-events'] })
  }
  const confirm = async (): Promise<void> => {
    if (!review || !current || busy || submitted || gas.data === undefined) return
    const at = revision.current
    setBusy(true); setError(undefined)
    try {
      await executeTransfer(review.request, { identity: review.identity, getIdentity: wallet.getIdentity,
        isCurrentForm: () => revision.current === at,
        onProgress: next => {
          setProgress(next)
          if (next.hash && next.to) {
            const record: SubmittedTransaction = { chainId: CHAIN_ID, hash: next.hash, account: review.identity.address,
              to: next.to, kind: 'send', submittedAt: Date.now(), status: 'pending' }
            recordTransaction(record); setSubmitted(record)
          }
          if (next.stage === 'tradeSucceeded' && next.hash) { updateTransaction(next.hash, 'success'); setSubmitted(undefined); refresh() }
        } })
    } catch (cause) { setError(tradeError(cause)) } finally { setBusy(false) }
  }
  const recheck = async (): Promise<void> => {
    if (!submitted || checking) return
    setChecking(true); setError(undefined)
    try {
      const status = await receiptStatus(rpc, submitted.hash, submitted.account, submitted.to)
      if (status === 'pending') setError('tradePending')
      else { updateTransaction(submitted.hash, 'success'); setProgress({ stage: 'tradeSucceeded', hash: submitted.hash }); setSubmitted(undefined); refresh() }
    } catch (cause) {
      const code = tradeError(cause); setError(code)
      if (code === 'tradeReverted') { updateTransaction(submitted.hash, 'reverted'); setSubmitted(undefined) }
    } finally { setChecking(false) }
  }
  const done = progress?.stage === 'tradeSucceeded'
  return <Dialog title={`${m.send} ${token.currency.symbol}`} description={m.sendNote} onClose={() => { revision.current += 1; onClose() }}>
    {!review && !submitted ? <form className="lp-form" onSubmit={e => {
      e.preventDefault()
      const identity = wallet.getIdentity()
      if (validRecipient && validAmount && parsed.kind === 'valid' && identity?.chainId === CHAIN_ID) {
        setReview({ request: { currency: token.currency, recipient, amount: parsed.units }, identity }); setError(undefined)
      }
    }}>
      <label className="lp-field">{m.recipient}<input data-dialog-autofocus value={recipient} autoComplete="off" placeholder="0x…" onChange={e => { changed(); setRecipient(e.target.value.trim()) }} /></label>
      {recipient && !validRecipient && <p role="alert" className="error-text">{m.invalidRecipient}</p>}
      <label className="lp-field">{m.amount}<input inputMode="decimal" value={amount} onChange={e => { changed(); setAmount(e.target.value) }} /></label>
      <p className="data-muted">{m.balance}: {token.balance === undefined ? '—' : formatUnits(token.balance, token.currency.decimals)} {token.currency.symbol}</p>
      {amount && !validAmount && <p role="alert" className="error-text">{m.invalidAmount}</p>}
      <Button appearance="primary" type="submit" disabled={!validRecipient || !validAmount || token.balance === undefined || !wallet.session || wallet.session.chainId !== CHAIN_ID}>{m.preview}</Button>
    </form> : <>
      {review && <dl className="review-details"><div><dt>{m.network}</dt><dd>X Layer · 196</dd></div>
        <div><dt>{m.token}</dt><dd>{token.currency.symbol}</dd></div>
        <div><dt>{m.amount}</dt><dd>{formatUnits(review.request.amount, token.currency.decimals)}</dd></div>
        <div><dt>{m.recipient}</dt><dd className="address-full">{review.request.recipient}</dd></div>
        <div><dt>{t('networkLabel')}</dt><dd>{gas.data === undefined ? '—' : `${formatUnits(gas.data, 18)} OKB`}</dd></div></dl>}
      {gas.isFetching && <p role="status">{m.loading}</p>}
      {gas.isError && !submitted && <p className="error-text" role="alert">{m.unavailable} <Button onClick={() => void gas.refetch()}>{m.retry}</Button></p>}
      {done && <p role="status">{m.sent}</p>}
      {progress && !done && <p role="status">{t(progress.stage)}</p>}
      {(error || (review && !current)) && !done && <p role="alert" className="error-text">{t(error ?? 'tradeIdentityChanged')}</p>}
      {(submitted?.hash || progress?.hash) && <a className="transaction-link" href={`${EXPLORER_URL}/tx/${submitted?.hash ?? progress?.hash}`} target="_blank" rel="noreferrer">{m.viewTransaction}<Icon name="external" size={14} /></a>}
      {submitted ? <Button className="swap-action" onClick={() => void recheck()} disabled={busy || checking}>{m.receipt}</Button>
        : done ? <Button className="swap-action" onClick={onClose}>{m.close}</Button>
          : <Button appearance="primary" className="swap-action" onClick={() => void confirm()} disabled={busy || !current || gas.data === undefined || gas.isFetching || gas.isError}>{busy ? t('waitingConfirmation') : m.confirmSend}</Button>}
    </>}
  </Dialog>
}
