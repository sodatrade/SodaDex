import { useQuery } from '@tanstack/react-query'
import { useId, useState, type ReactElement } from 'react'
import { formatUnits } from 'viem'
import { Button } from '../../components/primitives'
import { parseAmount } from '../../domain/amount'
import { exploreMessages } from '../../i18n/explore'
import { usePreferences } from '../../preferences/context'
import { getReferenceQuote, type ReferencePool } from './referenceApi'
export function ReferenceQuotePanel({ pool }: { pool: ReferencePool }): ReactElement {
  const { locale } = usePreferences(), m = exploreMessages(locale), id = useId()
  const [direction, setDirection] = useState(true), [amount, setAmount] = useState('')
  const from = direction ? pool.token0 : pool.token1, to = direction ? pool.token1 : pool.token0
  const complete = from.decimals !== null && to.decimals !== null
  const parsed = parseAmount(amount, from.decimals ?? 0), valid = complete && parsed.kind === 'valid' && parsed.units < 2n ** 128n
  const quote = useQuery({ queryKey: ['reference-quote', pool.protocol, pool.id, direction, valid ? parsed.units.toString() : ''],
    queryFn: () => getReferenceQuote(pool, direction, valid ? parsed.units : 0n), enabled: valid && !pool.stateError, retry: false })
  return <section className="explore-reference-quote" aria-label={m.readOnly}>
    <strong>{m.readOnly}</strong><p>{pool.protocol.toUpperCase()} · {from.symbol ?? from.address} / {to.symbol ?? to.address}</p>
    {!complete ? <p role="alert">{m.metadataMissing}</p> : <>
      <label htmlFor={id}>{m.pay} · {from.symbol}<input id={id} inputMode="decimal" autoComplete="off" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" aria-invalid={!!amount && !valid} /></label>
      {!!amount && !valid && <p role="alert">{m.invalidAmount}</p>}
      <div className="explore-quote-output"><Button appearance="ghost" onClick={() => { setDirection(v => !v); setAmount('') }}>{m.reverse}</Button>
        <output aria-label={m.receive}>{valid && quote.data && !quote.isError ? `${formatUnits(BigInt(quote.data.amountOutRaw), to.decimals!)} ${to.symbol ?? ''}` : '—'}</output></div>
      {quote.isFetching && <p role="status">{m.loading}</p>}
      {quote.isError && <p role="alert" className="error-text">{m.error} <Button onClick={() => void quote.refetch()}>{m.retry}</Button></p>}
    </>}
  </section>
}
