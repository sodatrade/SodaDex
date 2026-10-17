import { useId, useState, type ReactElement } from 'react'
import { tradeMarketMessages } from '../../i18n/tradeMarket'
import { usePreferences } from '../../preferences/context'
import { plotGeometry, type PlotCandle } from './marketModel'
export function formatPrice(value: number | undefined, locale: string): string {
  return value === undefined ? '—' : new Intl.NumberFormat(locale, { maximumSignificantDigits: 8 }).format(value)
}
export function TradeChart({ candles, mode, unit }: { candles: PlotCandle[]; mode: 'line' | 'candles'; unit: string }): ReactElement {
  const { locale } = usePreferences(), m = tradeMarketMessages(locale), id = useId()
  const [selected, setSelected] = useState<number>()
  const geometry = plotGeometry(candles), point = candles[selected ?? candles.length - 1] ?? candles.at(-1)
  if (!geometry || !point) return <p className="trade-market-empty">{m.noTrades}</p>
  const { x, y, min, max } = geometry
  const time = (timestamp: number): string => new Date(timestamp * 1000).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return <figure className="trade-price-chart">
    <figcaption id={id}><span>{time(point.time)}</span><span>{m.open} {formatPrice(point.open, locale)}</span><span>{m.high} {formatPrice(point.high, locale)}</span>
      <span>{m.low} {formatPrice(point.low, locale)}</span><span>{m.close} {formatPrice(point.close, locale)}</span></figcaption>
    <div className="trade-chart-frame"><svg viewBox="0 0 720 260" preserveAspectRatio="none" role="img" tabIndex={0}
      aria-label={`${mode === 'candles' ? m.candles : m.line} · ${unit} · ${m.candleCount} ${candles.length}`}
      aria-describedby={id}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect(), at = (event.clientX - bounds.left) / bounds.width * 720
        let nearest = 0
        for (let i = 1; i < candles.length; i += 1) if (Math.abs(x(candles[i].time) - at) < Math.abs(x(candles[nearest].time) - at)) nearest = i
        setSelected(nearest)
      }} onPointerLeave={() => setSelected(undefined)} onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        setSelected(event.key === 'Home' ? 0 : event.key === 'End' ? candles.length - 1 : Math.max(0, Math.min(candles.length - 1, (selected ?? candles.length - 1) + (event.key === 'ArrowRight' ? 1 : -1))))
      }}>
      <path d="M0 18H720M0 130H720M0 242H720" stroke="var(--soda-line-soft)" fill="none" vectorEffect="non-scaling-stroke" />
      {mode === 'line' ? <><polyline points={candles.map((c) => `${x(c.time)},${y(c.close)}`).join(' ')} stroke="var(--soda-highlight)" strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke" />
        {candles.length === 1 && <circle cx={x(point.time)} cy={y(point.close)} r="4" fill="var(--soda-highlight)" />}</>
        : candles.map((c) => <g key={c.time} data-candle-time={c.time} fill={c.close >= c.open ? 'var(--soda-highlight)' : 'var(--soda-error)'} stroke={c.close >= c.open ? 'var(--soda-highlight)' : 'var(--soda-error)'}>
          <line x1={x(c.time)} x2={x(c.time)} y1={y(c.high)} y2={y(c.low)} vectorEffect="non-scaling-stroke" />
          <rect x={x(c.time) - 3} width="6" y={Math.min(y(c.open), y(c.close))} height={Math.max(1, Math.abs(y(c.open) - y(c.close)))} stroke="none" />
        </g>)}
      {selected !== undefined && <path d={`M${x(point.time)} 8V250`} stroke="var(--soda-muted)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
    </svg><div className="trade-chart-axis" aria-hidden="true"><span>{formatPrice(max, locale)}</span><span>{formatPrice((min + max) / 2, locale)}</span><span>{formatPrice(min, locale)}</span></div></div>
    <div className="trade-chart-times"><span>{time(candles[0].time)}</span><span>{candles.length > 1 ? time(candles.at(-1)!.time) : unit}</span></div>
  </figure>
}
