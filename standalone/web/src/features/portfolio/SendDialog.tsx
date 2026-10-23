import { useQuery } from '@tanstack/react-query'
import { useRef, useState, type ReactElement } from 'react'
import { formatUnits, isAddress, zeroAddress } from 'viem'
import { Dialog } from '../../components/Dialog'
import { Button, Icon } from '../../components/primitives'
import { amountError, parseAmount } from '../../domain/amount'
import { CHAIN_ID, EXPLORER_URL } from '../../domain/assets'
import { workspaceMessages } from '../../i18n/workspace'
import { hexQuantity, rpc } from '../../lib/rpc'
import type { WalletController } from '../../lib/useWallet'
import { usePreferences } from '../../preferences/context'
import { buildTransfer, type TransferRequest } from '../../trading/transfers'
import type { TradeIdentity } from '../../trading/types'
import type { PortfolioToken } from './usePortfolioTokens'
import { useSendOperation } from './useSendOperation'
export function SendDialog({ token, wallet, onClose }: { token: PortfolioToken; wallet: WalletController; onClose: () => void }): ReactElement {
  const { locale, t } = usePreferences(), m = workspaceMessages(locale)
  const [recipient, setRecipient] = useState(''), [amount, setAmount] = useState('')
  const [review, setReview] = useState<{ request: TransferRequest; identity: TradeIdentity }>()
  const operation = useSendOperation(wallet)
  const openedIdentity = useRef(wallet.getIdentity()).current
  const parsed = parseAmount(amount, token.currency.decimals)
  const validRecipient = isAddress(recipient) && recipient.toLowerCase() !== zeroAddress
  const validAmount = parsed.kind === 'valid' && !amountError(amount, token.balance, token.currency.decimals)
  const identity = wallet.getIdentity()
  const formCurrent = !!identity && identity.revision === openedIdentity?.revision && identity.provider === openedIdentity?.provider && identity.chainId === CHAIN_ID
  const current = !!review && identity?.revision === review.identity.revision && identity?.provider === review.identity.provider && identity?.address === review.identity.address && identity?.chainId === CHAIN_ID
  const gas = useQuery({ queryKey: ['send-gas', review?.identity.address, review?.request.recipient,
    review?.request.amount.toString(), token.currency.address, token.currency.native], enabled: !!review && current && !operation.pending,
    retry: false, staleTime: 0, queryFn: async () => {
      const tx = buildTransfer(review!.request, review!.identity.address)
      const [units, price] = await Promise.all([rpc('eth_estimateGas', [tx]), rpc('eth_gasPrice')])
      if (hexQuantity(units) <= 0n) throw new Error('Invalid gas estimate')
      return hexQuantity(units) * hexQuantity(price)
    } })
  const changed = (): void => { operation.cancel(); operation.reset(); setReview(undefined) }
  const close = (): void => { operation.cancel(); onClose() }
  const recover = operation.pending || (operation.recovered && !!operation.record && !review)
  return <Dialog title={recover ? m.send : `${m.send} ${token.currency.symbol}`} description={m.sendNote} onClose={close}>
    {operation.recovered && <p className="dialog-note">{m.receiptRecovered}</p>}
    {!review && !recover ? <form className="portfolio-send-form" onSubmit={(event) => {
      event.preventDefault()
      const snapshot = wallet.getIdentity()
      if (validRecipient && validAmount && parsed.kind === 'valid' && token.balance !== undefined && formCurrent && snapshot?.chainId === CHAIN_ID)
        setReview({ request: { currency: token.currency, recipient, amount: parsed.units }, identity: snapshot })
    }}>
      <label>{m.recipient}<input data-dialog-autofocus value={recipient} autoComplete="off" placeholder="0x…" disabled={!formCurrent} onChange={(event) => { changed(); setRecipient(event.target.value.trim()) }} /></label>
      {recipient && !validRecipient && <p role="alert" className="error-text">{m.invalidRecipient}</p>}
      <label>{m.amount}<input inputMode="decimal" value={amount} disabled={!formCurrent} onChange={(event) => { changed(); setAmount(event.target.value.slice(0, 100)) }} /></label>
      <p className="portfolio-muted">{m.balance}: {token.balance === undefined ? '—' : formatUnits(token.balance, token.currency.decimals)} {token.currency.symbol}</p>
      {amount && !validAmount && <p role="alert" className="error-text">{m.invalidAmount}</p>}
      {!formCurrent && <p role="alert" className="error-text">{t('tradeIdentityChanged')}</p>}
      <Button appearance="primary" type="submit" disabled={!formCurrent || !validRecipient || !validAmount || token.balance === undefined || !wallet.session || wallet.session.chainId !== CHAIN_ID}>{m.preview}</Button>
    </form> : <>
      {review && <dl className="review-details"><div><dt>{m.network}</dt><dd>X Layer · 196</dd></div>
        <div><dt>{m.token}</dt><dd>{token.currency.symbol}</dd></div><div><dt>{m.amount}</dt><dd>{formatUnits(review.request.amount, token.currency.decimals)}</dd></div>
        <div><dt>{m.recipient}</dt><dd className="address-full">{review.request.recipient}</dd></div>
        <div><dt>{m.estimatedNetworkFee}</dt><dd>{gas.data === undefined ? '—' : `${formatUnits(gas.data, 18)} OKB`}</dd></div></dl>}
      {gas.isFetching && <p role="status">{m.loading}</p>}
      {gas.isError && !operation.pending && <p className="error-text" role="alert">{m.unavailable} <Button onClick={() => void gas.refetch()}>{m.retry}</Button></p>}
      {operation.done && <p role="status">{m.sent}</p>}
      {operation.progress && !operation.done && <p role="status">{t(operation.progress.stage)}</p>}
      {(operation.error || (review && !current)) && !operation.done && <p role="alert" className="error-text">{t(operation.error ?? 'tradeIdentityChanged')}</p>}
      {operation.record && <a className="transaction-link" href={`${EXPLORER_URL}/tx/${operation.record.hash}`} target="_blank" rel="noreferrer">{m.viewTransaction}<Icon name="external" size={14} /></a>}
      {operation.pending ? <Button className="swap-action" onClick={() => void operation.recheck()} disabled={operation.busy || operation.checking}>{m.receipt}</Button>
        : operation.done ? <Button className="swap-action" onClick={close}>{m.close}</Button>
          : <><Button appearance="primary" className="swap-action" onClick={() => { if (review && current && !gas.isFetching && !gas.isError && gas.data !== undefined) void operation.execute(review.request, review.identity) }}
            disabled={operation.busy || !current || gas.data === undefined || gas.isFetching || gas.isError || !!operation.error}>{operation.busy ? t('waitingConfirmation') : m.confirmSend}</Button>
            {!operation.busy && <Button appearance="ghost" onClick={changed}>{m.sendAgain}</Button>}</>}
    </>}
  </Dialog>
}
