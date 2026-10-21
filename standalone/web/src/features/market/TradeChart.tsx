import { compactMarketNumber } from '../../domain/compactDecimal'
import { useId, useState, type ReactElement } from 'react'
import { tradeMarketMessages } from '../../i18n/tradeMarket'
import { usePreferences } from '../../preferences/context'
import { plotGeometry, type PlotCandle } from './marketModel'
export function formatPrice(value: number | undefined, locale: string): string {
  return value === undefined ? '—' : compactMarketNumber(value, locale, 8)
}
export function TradeChart({ candles, mode, unit }: { candles: PlotCandle[]; mode: 'line' | 'candles'; unit: string }): ReactElement {
  const { locale } = usePreferences(), m = tradeMarketMessages(locale), id = useId()
  const [selected, setSelected] = useState<number>()
  const geometry = plotGeometry(candles), point = candles[selected ?? candles.length - 1] ?? candles.at(-1)
  if (!geometry || !point) return <p className="trade-market-empty">{m.noTrades}</p>
  const { x, y, min, max } = geometry
  const line = candles.map((c) => `${x(c.time)},${y(c.close)}`).join(' ')
  const change = (point.close / candles[0].open - 1) * 100
  const gradientId = `${id}-area`, gridId = `${id}-grid`
  const time = (timestamp: number): string => new Date(timestamp * 1000).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return <figure className="trade-price-chart">
    <div className="trade-chart-readout"><strong>{formatPrice(point.close, locale)} <small>{unit}</small></strong>
      <div><span className={change >= 0 ? 'chart-positive' : 'chart-negative'}>{change >= 0 ? '↗ +' : '↘ '}{change.toFixed(2)}%</span><time>{time(point.time)}</time></div></div>
    <figcaption id={id}><span>{m.open} {formatPrice(point.open, locale)}</span><span>{m.high} {formatPrice(point.high, locale)}</span>
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
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--soda-highlight)" stopOpacity=".24" /><stop offset="100%" stopColor="var(--soda-highlight)" stopOpacity="0" /></linearGradient>
        <pattern id={gridId} width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="12" cy="12" r=".8" fill="var(--soda-muted)" opacity=".22" /></pattern>
      </defs>
      <rect width="720" height="260" fill={`url(#${gridId})`} />
      {mode === 'line' ? <><polygon points={`${x(candles[0].time)},260 ${line} ${x(candles.at(-1)!.time)},260`} fill={`url(#${gradientId})`} />
        <polyline points={line} stroke="var(--soda-highlight)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" fill="none" vectorEffect="non-scaling-stroke" />
        {candles.length === 1 && <circle data-observation="true" cx={x(point.time)} cy={y(point.close)} r="4" fill="var(--soda-highlight)" />}</>
        : candles.map((c) => <g key={c.time} data-candle-time={c.time} fill={c.close >= c.open ? 'var(--soda-highlight)' : 'var(--soda-error)'} stroke={c.close >= c.open ? 'var(--soda-highlight)' : 'var(--soda-error)'}>
          <line x1={x(c.time)} x2={x(c.time)} y1={y(c.high)} y2={y(c.low)} vectorEffect="non-scaling-stroke" />
          <rect x={x(c.time) - 3} width="6" y={Math.min(y(c.open), y(c.close))} height={Math.max(1, Math.abs(y(c.open) - y(c.close)))} stroke="none" />
        </g>)}
      {selected !== undefined && <g>
        <path d={`M${x(point.time)} 0V260 M0 ${y(point.close)}H720`} stroke="var(--soda-muted)" strokeOpacity=".45" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
        <circle cx={x(point.time)} cy={y(point.close)} r="8" fill="var(--soda-highlight)" opacity=".18" />
        <circle cx={x(point.time)} cy={y(point.close)} r="4" fill="var(--soda-highlight)" stroke="var(--soda-surface)" strokeWidth="2" />
      </g>}
    </svg><div className="trade-chart-axis" aria-hidden="true">{[1, .75, .5, .25, 0].map((fraction) => <span key={fraction}>{formatPrice(min + (max - min) * fraction, locale)}</span>)}</div></div>
    <div className="trade-chart-times"><span>{time(candles[0].time)}</span><span>{candles.length > 1 ? time(candles.at(-1)!.time) : unit}</span></div>
  </figure>
}
