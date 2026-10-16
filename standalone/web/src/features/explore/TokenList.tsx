import { useState, type ReactElement } from 'react'
import type { Address } from 'viem'
import { Button, Icon } from '../../components/primitives'
import { EXPLORER_URL, shortenAddress } from '../../domain/assets'
import { exploreMessages } from '../../i18n/explore'
import { usePreferences } from '../../preferences/context'
import { TokenIcon } from '../../components/TokenIcon'
import { builtinTokens, useExploreCatalog } from './catalog'
export function TokenList({ onToken }: { onToken: (address: Address) => void }): ReactElement {
  const { locale } = usePreferences(), m = exploreMessages(locale), catalog = useExploreCatalog()
  const [search, setSearch] = useState(''), query = search.trim().toLowerCase()
  const tokens = (catalog.data?.tokens ?? builtinTokens).filter(({ currency: c }) => `${c.symbol} ${c.name} ${c.address}`.toLowerCase().includes(query))
  return <div className="explore-tokens">
    <label className="search-field"><Icon name="search" /><input aria-label={m.search} placeholder={m.search} value={search} onChange={e => setSearch(e.target.value)} /></label>
    <p className="explore-note">{m.noFiat}</p>
    {catalog.isFetching && <p role="status">{m.loading}</p>}
    {(catalog.isError || catalog.data?.partial) && <p role="alert" className="explore-warning">{m.partial} <Button appearance="ghost" onClick={() => void catalog.refetch()}>{m.retry}</Button></p>}
    <div className="explore-token-table" role="table" aria-label={m.tokens}>
      <div className="explore-token-row explore-table-heading" role="row"><span role="columnheader">{m.token}</span><span role="columnheader">{m.source}</span><span role="columnheader">{m.contract}</span></div>
      {tokens.map(({ currency: c, source }) => <div className="explore-token-row" role="row" key={c.address}>
        <div role="cell"><button className="explore-token-name" onClick={() => onToken(c.address)}><TokenIcon address={c.address} symbol={c.symbol} native={c.native} small /><span><strong>{c.symbol}</strong><small>{c.name}</small></span></button></div>
        <span role="cell" className="explore-source">{m[source]}</span><span role="cell">{c.native ? m.native : <a href={`${EXPLORER_URL}/address/${c.address}`} target="_blank" rel="noreferrer" title={c.address}>{shortenAddress(c.address)} <Icon name="external" size={12} /></a>}</span>
      </div>)}
    </div>
    {!tokens.length && <p>{m.empty}</p>}
  </div>
}
