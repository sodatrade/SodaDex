import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { isAddress } from 'viem'
import { Dialog } from '../../components/Dialog'
import { AssetIcon, Button, Icon } from '../../components/primitives'
import { shortenAddress, STABLE_ADDRESS, WOKB_ADDRESS } from '../../domain/assets'
import { tradeMessages } from '../../i18n/trade'
import { importCurrency } from '../../liquidity'
import type { Currency } from '../../liquidity/types'
import { usePreferences } from '../../preferences/context'
import { referenceTokens } from './referenceTokens'
import { currencyKey, sameCurrency } from './routes'
export function CurrencyIcon({ currency }: { currency: Currency }): ReactElement {
  const address = currency.address.toLowerCase()
  const known = currency.native ? 'okb' : address === WOKB_ADDRESS.toLowerCase() ? 'wokb' : address === STABLE_ADDRESS.toLowerCase() ? 'usdt0' : undefined
  return known ? <AssetIcon assetId={known} small /> : <span className="swap-token-initial" aria-hidden="true">{currency.symbol.slice(0, 2).toUpperCase()}</span>
}
export function CurrencyPicker({ currencies, selected, onSelect, onClose }: {
  currencies: Currency[]; selected: Currency; onSelect: (currency: Currency) => void; onClose: () => void
}): ReactElement {
  const { locale } = usePreferences(), m = tradeMessages(locale)
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const importer = useMutation({ mutationFn: () => importCurrency(search.trim()), retry: false })
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const reference = useQuery({ queryKey: ['reference-tokens'], queryFn: referenceTokens, retry: false, staleTime: 300_000 })
  const checker = useMutation({ mutationFn: (address: string) => importCurrency(address), retry: false,
    onSuccess: (currency) => { if (active.current) onSelect(currency) } })
  const candidates = (reference.data ?? []).filter((c) => !currencies.some((v) => sameCurrency(c, v)) && `${c.symbol} ${c.name} ${c.address}`.toLowerCase().includes(query))
  const visible = currencies.filter((c) => `${c.symbol} ${c.name} ${c.address}`.toLowerCase().includes(query))
  return <Dialog title={m.choose} description={m.importNote} onClose={onClose}>
    <label className="search-field"><Icon name="search" /><input autoFocus data-dialog-autofocus aria-label={m.search}
      placeholder={m.search} value={search} onChange={(e) => { setSearch(e.target.value); importer.reset() }} /></label>
    <div className="asset-options swap-token-options">{visible.map((currency) => <button className="asset-option" key={currencyKey(currency)}
      aria-pressed={sameCurrency(currency, selected)} onClick={() => onSelect(currency)}>
      <CurrencyIcon currency={currency} /><span className="asset-option-label"><strong>{currency.symbol}</strong><span>{currency.native ? m.native : currency.name}</span>
        {!currency.native && <small>{shortenAddress(currency.address)}</small>}</span>{sameCurrency(currency, selected) && <Icon name="check" />}
    </button>)}</div>
    {candidates.length > 0 && <><p className="swap-reference-label">{m.reference}</p><div className="asset-options swap-token-options">{candidates.map((currency) =>
      <button className="asset-option" key={currencyKey(currency)} disabled={checker.isPending} onClick={() => checker.mutate(currency.address)}>
        <CurrencyIcon currency={currency} /><span className="asset-option-label"><strong>{currency.symbol}</strong><span>{currency.name}</span><small>{shortenAddress(currency.address)}</small></span>
      </button>)}</div></>}
    {checker.isPending && <p role="status">{m.referenceLoading}</p>}
    {checker.error && <p role="alert" className="error-text">{m.invalidToken}</p>}
    {isAddress(search.trim(), { strict: false }) && !visible.length && <div className="swap-import">
      {!importer.data ? <Button onClick={() => importer.mutate()} disabled={importer.isPending}>{importer.isPending ? m.loading : m.import}</Button> : <>
        <div className="swap-import-preview"><CurrencyIcon currency={importer.data} /><strong>{importer.data.symbol}</strong><span>{importer.data.name}</span></div>
        <code className="swap-contract-address">{importer.data.address}</code>
        <Button appearance="primary" onClick={() => { if (importer.data) onSelect(importer.data) }}>{m.import}</Button></>}
    </div>}
    {importer.error && <p role="alert" className="error-text">{m.invalidToken}</p>}
  </Dialog>
}
