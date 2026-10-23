import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { isAddress } from 'viem'
import { Dialog } from '../../components/Dialog'
import { Button, Icon } from '../../components/primitives'
import { Pagination, usePagination } from '../../components/Pagination'
import { TokenIcon } from '../../components/TokenIcon'
import { shortenAddress } from '../../domain/assets'
import { tradeMessages } from '../../i18n/trade'
import { importCurrency } from '../../liquidity'
import type { Currency } from '../../liquidity/types'
import { usePreferences } from '../../preferences/context'
import { referenceTokens } from './referenceTokens'
import { currencyKey, sameCurrency } from './routes'
export function CurrencyIcon({ currency }: { currency: Currency }): ReactElement {
  return <TokenIcon address={currency.address} symbol={currency.symbol} native={currency.native} small />
}
export function CurrencyPicker({ currencies, selected, onSelect, onClose, poolOnly = false, loading = false, failed = false, onRetry }: {
  currencies: Currency[]; selected: Currency; onSelect: (currency: Currency) => void; onClose: () => void; poolOnly?: boolean
  loading?: boolean; failed?: boolean; onRetry?: () => void
}): ReactElement {
  const { locale } = usePreferences(), m = tradeMessages(locale)
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const importer = useMutation({ mutationFn: () => importCurrency(search.trim()), retry: false })
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const reference = useQuery({ queryKey: ['reference-tokens'], queryFn: referenceTokens, enabled: !poolOnly, retry: false, staleTime: 300_000 })
  const checker = useMutation({ mutationFn: (address: string) => importCurrency(address), retry: false,
    onSuccess: (currency) => { if (active.current) onSelect(currency) } })
  const candidates = (poolOnly ? [] : reference.data ?? []).filter((c) => !currencies.some((v) => sameCurrency(c, v)) && `${c.symbol} ${c.name} ${c.address}`.toLowerCase().includes(query))
  const visible = currencies.filter((c) => `${c.symbol} ${c.name} ${c.address}`.toLowerCase().includes(query))
  const pagination = usePagination([...visible.map((currency) => ({ currency, reference: false })), ...candidates.map((currency) => ({ currency, reference: true }))], query)
  const pageCurrencies = pagination.items.filter((entry) => !entry.reference)
  const pageCandidates = pagination.items.filter((entry) => entry.reference)
  return <Dialog title={m.choose} description={poolOnly ? m.poolTokensNote : m.importNote} onClose={onClose}>
    <div className="swap-token-picker"><label className="search-field"><Icon name="search" /><input autoFocus data-dialog-autofocus aria-label={m.search}
      placeholder={m.search} value={search} onChange={(e) => { setSearch(e.target.value); importer.reset() }} /></label>
    <div className="swap-token-scroll"><div className="asset-options swap-token-options">{pageCurrencies.map(({ currency }) => <button className="asset-option" key={currencyKey(currency)}
      aria-pressed={sameCurrency(currency, selected)} onClick={() => onSelect(currency)}>
      <CurrencyIcon currency={currency} /><span className="asset-option-label"><strong>{currency.symbol}</strong><span>{currency.native ? m.native : currency.name}</span>
        {!currency.native && <small>{shortenAddress(currency.address)}</small>}</span>{sameCurrency(currency, selected) && <Icon name="check" />}
    </button>)}</div>
    {pageCandidates.length > 0 && <><p className="swap-reference-label">{m.reference}</p><div className="asset-options swap-token-options">{pageCandidates.map(({ currency }) =>
      <button className="asset-option" key={currencyKey(currency)} disabled={checker.isPending} onClick={() => checker.mutate(currency.address)}>
        <CurrencyIcon currency={currency} /><span className="asset-option-label"><strong>{currency.symbol}</strong><span>{currency.name}</span><small>{shortenAddress(currency.address)}</small></span>
      </button>)}</div></>}
    <Pagination {...pagination} />
    {poolOnly && !visible.length && <p role={failed ? 'alert' : 'status'} className="swap-notice">{loading ? m.loading : failed ? m.poolError : m.noPoolToken}{failed && onRetry && <Button onClick={onRetry}>{m.reload}</Button>}</p>}
    {checker.isPending && <p role="status">{m.referenceLoading}</p>}
    {checker.error && <p role="alert" className="error-text">{m.invalidToken}</p>}
    {!poolOnly && isAddress(search.trim(), { strict: false }) && !visible.length && <div className="swap-import">
      {!importer.data ? <Button onClick={() => importer.mutate()} disabled={importer.isPending}>{importer.isPending ? m.loading : m.import}</Button> : <>
        <div className="swap-import-preview"><CurrencyIcon currency={importer.data} /><strong>{importer.data.symbol}</strong><span>{importer.data.name}</span></div>
        <code className="swap-contract-address">{importer.data.address}</code>
        <Button appearance="primary" onClick={() => { if (importer.data) onSelect(importer.data) }}>{m.import}</Button></>}
    </div>}
    {importer.error && <p role="alert" className="error-text">{m.invalidToken}</p>}</div></div>
  </Dialog>
}
