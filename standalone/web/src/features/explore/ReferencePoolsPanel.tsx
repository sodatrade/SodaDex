import { useQuery } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { isAddress, zeroAddress, type Address } from 'viem'
import { Button, Icon } from '../../components/primitives'
import { Pagination, usePagination } from '../../components/Pagination'
import { EXPLORER_URL, STABLE_ADDRESS } from '../../domain/assets'
import { exploreMessages } from '../../i18n/explore'
import { usePreferences } from '../../preferences/context'
import { getReferencePools, type ReferencePool } from './referenceApi'
import { ReferenceQuotePanel } from './ReferenceQuotePanel'
export function ReferencePoolsPanel(): ReactElement {
  const { locale } = usePreferences(), m = exploreMessages(locale)
  const [a, setA] = useState<string>(zeroAddress), [b, setB] = useState<string>(STABLE_ADDRESS), [invalid, setInvalid] = useState(false)
  const [pair, setPair] = useState<readonly [Address, Address]>([zeroAddress, STABLE_ADDRESS]), [selected, setSelected] = useState<ReferencePool>()
  const query = useQuery({ queryKey: ['reference-pools', ...pair], queryFn: () => getReferencePools(...pair), retry: false })
  const pagination = usePagination(query.data?.pools ?? [], pair.join(':').toLowerCase())
  return <section className="explore-reference" aria-label={m.reference}>
    <div className="explore-readonly"><Icon name="layers" /><div><strong>{m.reference}</strong><p>{m.referenceNote}</p></div></div>
    <form className="explore-reference-form" onSubmit={e => {
      e.preventDefault()
      if (!isAddress(a.trim(), { strict: false }) || !isAddress(b.trim(), { strict: false }) || a.trim().toLowerCase() === b.trim().toLowerCase()) { setInvalid(true); return }
      setInvalid(false); setSelected(undefined); setPair([a.trim() as Address, b.trim() as Address])
    }}><label>{m.token0}<input value={a} onChange={e => setA(e.target.value)} spellCheck={false} /></label>
      <label>{m.token1}<input value={b} onChange={e => setB(e.target.value)} spellCheck={false} /></label><Button type="submit">{m.find}</Button></form>
    {invalid && <p className="error-text" role="alert">{m.invalidPair}</p>}
    <p className="explore-note">{m.candidate}</p>
    {query.isFetching && <p role="status">{m.loading}</p>}
    {query.isError && <p className="error-text" role="alert">{m.error} <Button onClick={() => void query.refetch()}>{m.retry}</Button></p>}
    {query.data && !query.isError && <>
      {query.data.errors.length > 0 && <p role="alert" className="explore-warning">{m.candidateError} <Button appearance="ghost" onClick={() => void query.refetch()}>{m.retry}</Button></p>}
      {!query.data.pools.length && !query.data.errors.length && <p>{m.noReference}</p>}
      <div className="explore-reference-pools">{pagination.items.map(pool => <article key={`${pool.protocol}:${pool.id}`}>
        <div className="explore-reference-row"><h3>{pool.token0.symbol ?? pool.token0.address} / {pool.token1.symbol ?? pool.token1.address}</h3><span>{pool.protocol.toUpperCase()} · {pool.fee / 10000}%</span></div>
        <dl className="explore-facts"><dt>{m.source}</dt><dd>Uniswap · {m.readOnly}</dd><dt>{m.poolId}</dt><dd>{pool.address
          ? <a href={`${EXPLORER_URL}/address/${pool.address}`} target="_blank" rel="noreferrer">{pool.address} <Icon name="external" size={12} /></a> : <code>{pool.id}</code>}</dd></dl>
        {pool.stateError ? <p role="alert">{m.error} <Button appearance="ghost" onClick={() => void query.refetch()}>{m.retry}</Button></p>
          : <Button appearance="ghost" onClick={() => setSelected(pool)}>{m.quote} →</Button>}
      </article>)}</div>
      <Pagination {...pagination} />
      {selected && <ReferenceQuotePanel key={`${selected.protocol}:${selected.id}`} pool={selected} />}
    </>}
  </section>
}
