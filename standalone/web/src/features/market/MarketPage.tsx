import { useQuery } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { formatUnits } from 'viem'
import { Button, Icon, Surface } from '../../components/primitives'
import { ASSETS, EXPLORER_URL, shortenAddress } from '../../domain/assets'
import { dataMessages } from '../../i18n/data'
import { usePreferences } from '../../preferences/context'
import { getMarket, getPools, type DexPool, type DexToken } from './api'
import { PriceChart } from './PriceChart'
import './data.css'

export function tokenName(address: string): string {
  return ASSETS.find((a) => a.address?.toLowerCase() === address.toLowerCase())?.symbol ??
    (/^0x0{40}$/.test(address) ? 'OKB' : shortenAddress(address))
}
function rawAmount(value: string | null, token: DexToken): string {
  return value !== null && /^\d+$/.test(value) && token.decimals !== null
    ? `${formatUnits(BigInt(value), token.decimals)} ${token.symbol ?? tokenName(token.address)}` : '—'
}
export function MarketPage(): ReactElement {
  const { locale } = usePreferences()
  const m = dataMessages(locale)
  const [selected, setSelected] = useState<string>()
  const [fromBlock, setFromBlock] = useState('')
  const [toBlock, setToBlock] = useState('')
  const [range, setRange] = useState<{ fromBlock: number; toBlock: number }>()
  const [rangeError, setRangeError] = useState(false)
  const pools = useQuery({ queryKey: ['dex-pools'], queryFn: getPools, retry: false, refetchInterval: 20_000 })
  const pool = pools.data?.pools.find((p) => p.id === selected) ?? pools.data?.pools[0]
  const market = useQuery({ queryKey: ['dex-market', pool?.id, range], queryFn: () => getMarket(pool as DexPool, range),
    enabled: !!pool, retry: false, refetchInterval: 20_000 })
  const d = market.data
  const symbol0 = d?.token0.symbol ?? tokenName(pool?.token0 ?? '')
  const symbol1 = d?.token1.symbol ?? tokenName(pool?.token1 ?? '')
  return (
    <section className="content-page data-page" aria-labelledby="market-title">
      <div className="page-heading"><span className="eyebrow">MARKET / X LAYER</span>
        <h1 id="market-title">{m.marketTitle}</h1><p>{m.marketNote}</p></div>
      <div className="data-toolbar">
        <label>{m.pool}<select value={pool?.id ?? ''} onChange={(e) => setSelected(e.target.value)}>
          {pools.data?.pools.map((p) => <option key={p.id} value={p.id}>
            {p.protocol.toUpperCase()} · {tokenName(p.token0)} / {tokenName(p.token1)} · {p.fee / 10000}%
          </option>)}
        </select></label>
        <Button onClick={() => { void pools.refetch(); void market.refetch() }} disabled={pools.isFetching || market.isFetching}>
          <Icon name="refresh" size={16} />{m.retry}
        </Button>
      </div>
      <form className="data-range" onSubmit={(e) => {
        e.preventDefault()
        if (!fromBlock && !toBlock) { setRange(undefined); setRangeError(false); return }
        const from = Number(fromBlock), to = Number(toBlock)
        if (!/^\d+$/.test(fromBlock) || !/^\d+$/.test(toBlock) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to) { setRangeError(true); return }
        setRangeError(false); setRange({ fromBlock: from, toBlock: to })
      }}>
        <label>{m.fromBlock}<input value={fromBlock} onChange={(e) => setFromBlock(e.target.value)} inputMode="numeric" placeholder={m.recent} /></label>
        <label>{m.toBlock}<input value={toBlock} onChange={(e) => setToBlock(e.target.value)} inputMode="numeric" placeholder={m.recent} /></label>
        <Button type="submit">{m.applyRange}</Button>
      </form>
      {rangeError && <p className="error-text" role="alert">{m.rangeError}</p>}
      {(pools.isPending || (pool && market.isPending)) && <p role="status">{m.loading}</p>}
      {(pools.isError || market.isError) && <p className="error-text" role="alert">{m.unavailable}</p>}
      {d && <>
        <Surface className="market-price-surface">
          <span className="eyebrow">{pool?.protocol.toUpperCase()} · {symbol0} / {symbol1}</span>
          <h2>{m.price}</h2>
          <p className="market-price" title={d.priceToken1PerToken0 ?? undefined}>{d.priceToken1PerToken0 === null ? m.noPrice :
            `1 ${symbol0} = ${Number(d.priceToken1PerToken0) > 0 && Number.isFinite(Number(d.priceToken1PerToken0))
              ? new Intl.NumberFormat(locale, { maximumSignificantDigits: 8 }).format(Number(d.priceToken1PerToken0)) : d.priceToken1PerToken0} ${symbol1}`}</p>
          <p className="data-muted">{m.snapshot} #{d.asOf.number} · {new Date(d.asOf.timestamp * 1000).toLocaleString(locale)}</p>
          <PriceChart market={d} />
          <div className="market-stats">
            <div><span>{m.fee}</span><strong>{d.pool.fee / 10000}%</strong></div>
            <div><span>{m.tick}</span><strong>{d.pool.tick ?? '—'}</strong></div>
            <div><span>{m.liquidity}</span><strong>{d.pool.liquidity ?? '—'}</strong></div>
          </div>
        </Surface>
        <div className="market-grid">
          <Surface><h2>{m.volume}</h2><p>{rawAmount(d.volume.token0Raw, d.token0)}</p><p>{rawAmount(d.volume.token1Raw, d.token1)}</p></Surface>
          <Surface><h2>{m.fees}</h2><p>{rawAmount(d.fees.token0Raw, d.token0)}</p><p>{rawAmount(d.fees.token1Raw, d.token1)}</p><small>{m.estimate}</small></Surface>
          <Surface><h2>{m.reserves}</h2><p>{rawAmount(d.reserves.token0Raw, d.token0)}</p><p>{rawAmount(d.reserves.token1Raw, d.token1)}</p>
            {d.pool.protocol === 'v4' && <small>{m.v4Reserves}</small>}</Surface>
        </div>
        <p className="data-muted">{m.coverage}: #{d.coverage.fromBlock} – #{d.coverage.toBlock} · {m.noFiat}</p>
        <a className="data-address" href={`${EXPLORER_URL}/address/${d.pool.address ?? d.pool.hooks}`} target="_blank" rel="noreferrer"
          hidden={d.pool.protocol === 'v4'}>{d.pool.id}<Icon name="external" size={14} /></a>
        {d.pool.protocol === 'v4' && <code className="data-address">Pool ID: {d.pool.id}</code>}
      </>}
    </section>
  )
}
