import type { ReactElement } from 'react'
import { dataMessages } from '../../i18n/data'
import { usePreferences } from '../../preferences/context'
import type { MarketResponse } from './api'

/** Each point is an observed Swap price. Gaps are block gaps, not fabricated candles. */
export function PriceChart({ market }: { market: MarketResponse }): ReactElement {
  const { locale } = usePreferences()
  const m = dataMessages(locale)
  const d0 = market.token0.decimals, d1 = market.token1.decimals
  const points = d0 === null || d1 === null ? [] : market.priceHistory.map((p) => ({
    block: p.blockNumber, price: (Number(p.sqrtPriceX96) / 2 ** 96) ** 2 * 10 ** (d0 - d1),
  })).filter((p) => Number.isFinite(p.price) && p.price > 0)
  if (!points.length) return <p className="data-muted">{m.chartEmpty}</p>
  const min = Math.min(...points.map((p) => p.price)), max = Math.max(...points.map((p) => p.price))
  const from = market.coverage.fromBlock, to = market.coverage.toBlock
  const line = points.map((p) => `${40 + (p.block - from) / Math.max(1, to - from) * 920},${max === min ? 110 : 180 - (p.price - min) / (max - min) * 150}`).join(' ')
  const label = (value: number): string => new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 }).format(value)
  return <figure className="price-chart">
    <figcaption>{m.priceHistory} · {market.token1.symbol} / {market.token0.symbol}</figcaption>
    <svg viewBox="0 0 1000 230" role="img" aria-label={`${m.priceHistory}: ${label(min)} – ${label(max)}`}>
      <path d="M40 30V190H960" stroke="var(--soda-line)" fill="none" />
      <polyline points={line} stroke="var(--soda-highlight)" strokeWidth="3" fill="none" />
      {points.length === 1 && <circle cx={line.split(',')[0]} cy="110" r="5" fill="var(--soda-highlight)" />}
      <text x="40" y="20">{label(max)}</text><text x="40" y="180">{label(min)}</text>
      <text x="40" y="220">#{from}</text><text x="960" y="220" textAnchor="end">#{to}</text>
    </svg>
  </figure>
}
