import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactElement } from 'react'
import type { Hex } from 'viem'
import { Button, Icon, Surface } from '../../components/primitives'
import { EXPLORER_URL, shortenAddress } from '../../domain/assets'
import { dataMessages } from '../../i18n/data'
import { usePreferences } from '../../preferences/context'
import { readTransactions, updateTransaction } from './journal'
import { readReceipt } from './receipts'

export function ReceiptLookup({ selectedHash }: { selectedHash?: Hex }): ReactElement {
  const { locale } = usePreferences()
  const m = dataMessages(locale)
  const [input, setInput] = useState('')
  const [hash, setHash] = useState<Hex>()
  const [invalid, setInvalid] = useState(false)
  const query = useQuery({ queryKey: ['public-receipt', hash], queryFn: () => readReceipt(hash as Hex), enabled: !!hash, retry: false })
  useEffect(() => { if (selectedHash) { setInput(selectedHash); setHash(selectedHash); setInvalid(false) } }, [selectedHash])
  useEffect(() => {
    const r = query.data
    if (r) {
      const saved = readTransactions().find((e) => e.hash.toLowerCase() === r.hash.toLowerCase())
      if (saved && saved.account.toLowerCase() === r.from.toLowerCase() && saved.to.toLowerCase() === r.to?.toLowerCase())
        updateTransaction(r.hash, r.status)
    }
  }, [query.data])
  return <Surface className="receipt-surface" aria-labelledby="receipt-title">
    <h2 id="receipt-title">{m.receipt}</h2>
    <form className="receipt-form" onSubmit={(e) => {
      e.preventDefault()
      if (!/^0x[\da-f]{64}$/i.test(input.trim())) { setInvalid(true); return }
      setInvalid(false)
      if (hash === input.trim()) void query.refetch()
      else setHash(input.trim() as Hex)
    }}>
      <label htmlFor="receipt-hash">{m.hash}<input id="receipt-hash" value={input} onChange={(e) => setInput(e.target.value)}
        placeholder="0x…" autoComplete="off" spellCheck={false} aria-invalid={invalid} aria-describedby={invalid ? 'receipt-error' : undefined} /></label>
      <Button type="submit" disabled={query.isFetching}>{m.lookup}</Button>
    </form>
    {invalid && <p className="error-text" id="receipt-error" role="alert">{m.invalidHash}</p>}
    {query.isFetching && <p role="status">{m.loading}</p>}
    {query.isError && <p className="error-text" role="alert">{m.unavailable}</p>}
    {query.isSuccess && query.data === null && <p role="status">{m.notFound}</p>}
    {query.data && <div role="status">
      <p>{m[query.data.status]}</p>
      <dl className="receipt-details"><dt>{m.block}</dt><dd>{query.data.blockNumber.toString()}</dd>
        <dt>From</dt><dd>{query.data.from}</dd><dt>To</dt><dd>{query.data.to ?? '—'}</dd>
        <dt>Gas</dt><dd>{query.data.gasUsed.toString()}</dd></dl>
      <a href={`${EXPLORER_URL}/tx/${query.data.hash}`} target="_blank" rel="noreferrer">
        {shortenAddress(query.data.hash)} <Icon name="external" size={14} /></a>
    </div>}
  </Surface>
}
