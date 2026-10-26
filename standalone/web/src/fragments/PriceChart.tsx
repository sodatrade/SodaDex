import { useId, useState, type ReactElement } from 'react'
import type { Messages } from './messages'
import { marketNumber, tradeAmount, type Trade } from './market'
import { recentChart } from './chartWindow'

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
    const nearest = chart.points.reduce<(typeof chart.points)[number] | undefined>((best, p) =>
      !best || Math.hypot(p.x - x, p.y - y) < Math.hypot(best.x - x, best.y - y) ? p : best, undefined)
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
        style={{ left: `clamp(0px, ${active.x / 640 * 100}%, calc(100% - 240px))` }}>
        <time>{time(active.trade.timestamp)}</time>
        <strong>{marketNumber(active.price)} OKB / {symbol}</strong>
        <span>{m.pay}: {tradeAmount(active.trade.input)} {active.trade.shareIn ? symbol : 'OKB'}</span>
        <span>{m.received}: {tradeAmount(active.trade.output)} {active.trade.shareIn ? 'OKB' : symbol}</span>
        <small>Tx {active.trade.transactionHash.slice(0, 10)}…{active.trade.transactionHash.slice(-6)}</small>
      </div>}
    </div>
    <div className="fragment-chart-times"><time dateTime={new Date(chart.start * 1000).toISOString()}>{time(chart.start)}</time><time dateTime={new Date(chart.end * 1000).toISOString()}>{time(chart.end)}</time></div>
    <p className="fragment-chart-help">{m.chartAutoHint}</p>
  </div>
}
