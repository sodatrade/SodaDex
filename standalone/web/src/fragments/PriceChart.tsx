import { useId, useState, type ReactElement } from 'react'
import type { Messages } from './messages'
import { marketNumber, tradeAmount, type Trade } from './market'
import { recentChart } from './chartWindow'

function chartTime(timestamp: number): string {
  const date = new Date(timestamp * 1000), offset = -date.getTimezoneOffset()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const zone = `UTC${offset < 0 ? '−' : '+'}${Math.floor(Math.abs(offset) / 60)}${offset % 60 ? `:${pad(Math.abs(offset) % 60)}` : ''}`
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${zone}`
}

export function PriceChart({ trades, symbol, m }: { trades: Trade[]; symbol: string; m: Messages }): ReactElement {
  const [selected, setSelected] = useState<string | null>(null)
  const fillId = useId(), tooltipId = useId()
  const chart = recentChart(trades)
  const first = chart.points[0], last = chart.points.at(-1)
  const active = chart.points.find(p => p.trade.id === selected)
  const selectNearest = (event: { clientX: number; clientY: number; currentTarget: SVGSVGElement }): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const x = (event.clientX - bounds.left) * 640 / bounds.width
    const y = (event.clientY - bounds.top) * 220 / bounds.height
    const nearest = chart.points.reduce<(typeof chart.points)[number] | undefined>((best, p) => {
      if (!best) return p
      const distance = Math.abs(p.x - x), bestDistance = Math.abs(best.x - x)
      return distance < bestDistance || distance === bestDistance && Math.abs(p.y - y) < Math.abs(best.y - y) ? p : best
    }, undefined)
    setSelected(nearest?.trade.id ?? null)
  }
  const time = (value: number): string => new Date(value * 1000).toLocaleString()
  if (!first || !last) return <div className="fragment-chart-empty">{m.noChart}</div>
  return <div className="fragment-price-chart">
    <div className="fragment-chart-plot" onMouseLeave={() => setSelected(null)}>
      <svg viewBox="0 0 640 220" role="group" aria-label={m.price} onPointerMove={selectNearest} onClick={selectNearest}>
        <title>{m.price}</title>
        <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--accent)" stopOpacity="0.14" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
        {[40,110,180].map(y => <line key={y} x1="20" x2="620" y1={y} y2={y} stroke="var(--border)" strokeDasharray="3 6" />)}
        <path d={`${chart.path} L${last.x},180 L${first.x},180 Z`} fill={`url(#${fillId})`} />
        <path d={chart.path} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
        {active && <g aria-hidden="true" pointerEvents="none">
          <line className="fragment-chart-crosshair" x1={active.x} x2={active.x} y1="20" y2="190" stroke="var(--muted)" strokeWidth="1" strokeDasharray="4 4" />
          <circle cx={active.x} cy={active.y} r="5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
        </g>}
        {chart.points.map((p, i) => <g key={p.trade.id}>
          <circle cx={p.x} cy={p.y} r={selected === p.trade.id ? 4 : 2} fill="var(--accent)" />
          <circle className="fragment-chart-point" cx={p.x} cy={p.y} r="10" fill="transparent" tabIndex={0} role="button"
            aria-label={`${m.chartTradePoint} ${i + 1}: ${time(p.trade.timestamp)}`} aria-describedby={selected === p.trade.id ? tooltipId : undefined}
            onMouseEnter={() => setSelected(p.trade.id)} onFocus={() => setSelected(p.trade.id)} onBlur={() => setSelected(null)}
            onPointerMove={event => { event.stopPropagation(); setSelected(p.trade.id) }}
            onClick={event => { event.stopPropagation(); setSelected(p.trade.id) }} onKeyDown={event => {
              if (event.key === 'Escape') setSelected(null)
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(p.trade.id) }
            }} />
        </g>)}
        <text x="620" y="28" textAnchor="end" fill="var(--muted)" fontSize="11">{marketNumber(chart.high)}</text>
        <text x="620" y="216" textAnchor="end" fill="var(--muted)" fontSize="11">{marketNumber(chart.low)}</text>
      </svg>
      {active && <div id={tooltipId} role="tooltip" className="fragment-chart-tooltip"
        style={{ left: `clamp(0px, calc(${active.x / 640 * 100}% ${active.x > 320 ? '- var(--fragment-tooltip-width) - 16px' : '+ 16px'}), calc(100% - var(--fragment-tooltip-width)))` }}>
        <time dateTime={new Date(active.trade.timestamp * 1000).toISOString()}>{chartTime(active.trade.timestamp)}</time>
        <strong aria-label={`${active.price} OKB / ${symbol}`}><span>{active.price.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 12 })}</span> <small>OKB</small></strong>
        <span className="fragment-chart-tooltip-details">{m.pay}: {tradeAmount(active.trade.input)} {active.trade.shareIn ? symbol : 'OKB'} · {m.received}: {tradeAmount(active.trade.output)} {active.trade.shareIn ? 'OKB' : symbol}</span>
      </div>}
    </div>
    <div className="fragment-chart-times"><time dateTime={new Date(chart.start * 1000).toISOString()}>{time(chart.start)}</time><time dateTime={new Date(chart.end * 1000).toISOString()}>{time(chart.end)}</time></div>
    <p className="fragment-chart-help">{m.chartAutoHint}</p>
  </div>
}
