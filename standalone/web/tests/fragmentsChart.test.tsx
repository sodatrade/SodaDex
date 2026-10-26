import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PriceChart } from '../src/fragments/PriceChart'
import { recentChart } from '../src/fragments/chartWindow'
import { messages } from '../src/fragments/messages'
import type { Trade } from '../src/fragments/market'

const base = 1792759069
function trade(index: number, price: number, timestamp = base + index * 600): Trade {
  return { id: String(index), timestamp, blockNumber: index, transactionHash: `0x${index.toString(16).padStart(64, '0')}`,
    shareIn: true, input: '1000000000000000000', output: String(Math.round(price * 1e18)), platformFee: '0', lpFee: '0' }
}
const trades = [trade(0, 0.2), ...Array.from({ length: 50 }, (_, i) => trade(i + 1, 0.0000024 + i * 0.00000001))]
const m = messages('en')
describe('automatic recent trades chart', () => {
  it('shows exactly the latest 50 trades with visible variation, preserving older source data', () => {
    const before = structuredClone(trades)
    const chart = recentChart(trades)
    expect(chart.points.map(p => p.trade.id)).toEqual(trades.slice(1).map(t => t.id))
    expect(chart.high).toBeLessThan(0.000003)
    expect(Math.max(...chart.points.map(p => p.y)) - Math.min(...chart.points.map(p => p.y))).toBeGreaterThan(100)
    expect(chart.points[0].x).toBe(20)
    expect(chart.points.at(-1)?.x).toBe(620)
    expect(trades).toEqual(before)
  })
  it('selects exactly 50 even when all trades share a timestamp', () => {
    const rows = Array.from({ length: 60 }, (_, i) => trade(i, 2, base))
    const chart = recentChart(rows)
    expect(chart.points).toHaveLength(50)
    expect(chart.points[0].trade.id).toBe('10')
    expect(chart.points.at(-1)?.trade.id).toBe('59')
    expect(chart.path).not.toMatch(/NaN|Infinity/)
  })
  it('shows all available trades when fewer than 50, with finite single and flat prices', () => {
    for (const rows of [[trade(1, 2)], [trade(1, 2), trade(2, 2)], [trade(1, 0), trade(2, 0)]]) {
      const chart = recentChart(rows)
      expect(chart.points).toHaveLength(rows.length)
      expect(chart.path).not.toMatch(/NaN|Infinity/)
      expect(chart.points.every(p => p.y >= 40 && p.y <= 180 && p.x >= 20 && p.x <= 620)).toBe(true)
    }
    render(<PriceChart trades={[trades[0]]} symbol="FABS" m={m} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })
  it('automatically rolls to new trades and removes a stale hovered trade', async () => {
    const { rerender } = render(<PriceChart trades={trades} symbol="FABS" m={m} />)
    await userEvent.hover(screen.getAllByRole('button')[0])
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    const next = trade(51, 0.000003)
    rerender(<PriceChart trades={[...trades, next]} symbol="FABS" m={m} />)
    expect(screen.getAllByRole('button')).toHaveLength(50)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')[0]).toHaveAccessibleName(`Trade point 1: ${new Date(trades[2].timestamp * 1000).toLocaleString()}`)
    expect(screen.getAllByRole('button').at(-1)).toHaveAccessibleName(`Trade point 50: ${new Date(next.timestamp * 1000).toLocaleString()}`)
  })
  it('shows exact trade time, price, paid and received assets for hover, focus and tap in both directions', async () => {
    const rows = [trade(1, 2), { ...trade(2, 3), shareIn: false }]
    render(<PriceChart trades={rows} symbol="FABS" m={m} />)
    const points = screen.getAllByRole('button')
    await userEvent.hover(points[0])
    expect(screen.getByRole('tooltip')).toHaveTextContent('2 OKB')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Pay: 1 FABS')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Received: 2 OKB')
    expect(screen.getByRole('tooltip').querySelector('time')).toHaveAttribute('dateTime', new Date(rows[0].timestamp * 1000).toISOString())
    expect(screen.getByRole('tooltip')).toHaveTextContent(/UTC[+−]\d/)
    await userEvent.unhover(points[0])
    await userEvent.tab()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Pay: 1 FABS')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await userEvent.click(points[1])
    expect(screen.getByRole('tooltip')).toHaveTextContent('Pay: 1 OKB')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Received: 3 FABS')
    expect(points[1]).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id)
  })
  it('renders an empty state without fabricated dates or prices', () => {
    expect(recentChart([]).points).toEqual([])
    render(<PriceChart trades={[]} symbol="FABS" m={m} />)
    expect(screen.getByText(m.noChart)).toBeInTheDocument()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })
  it('keeps the directly selected trade when multiple trades occupy the same chart position', () => {
    const rows = [trade(1, 2, base), { ...trade(2, 2, base), input: '3000000000000000000', output: '6000000000000000000' }, trade(3, 3)]
    render(<PriceChart trades={rows} symbol="FABS" m={m} />)
    const svg = screen.getByRole('group', { name: m.price })
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 640, 220))
    const [first, second] = screen.getAllByRole('button')
    const point = recentChart(rows).points[1]
    fireEvent.click(second, { clientX: point.x, clientY: point.y })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Pay: 3 FABS')
    fireEvent.focus(first)
    fireEvent.pointerMove(second, { clientX: point.x, clientY: point.y })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Received: 6 OKB')
  })
  it('follows the nearest trade time across the plot and aligns the vertical guide with that trade', () => {
    const rows = [trade(1, 1, base), trade(2, 2, base + 60), trade(3, 1, base + 600)]
    render(<PriceChart trades={rows} symbol="FABS" m={m} />)
    const svg = screen.getByRole('group', { name: m.price })
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 640, 220))
    fireEvent(svg, new MouseEvent('pointermove', { bubbles: true, clientX: 80, clientY: 180 }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('2 OKB')
    const guide = svg.querySelector('.fragment-chart-crosshair')
    expect(guide).toHaveAttribute('x1', '80')
    expect(guide).toHaveAttribute('x2', '80')
    fireEvent.mouseLeave(svg.parentElement!)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(svg.querySelector('.fragment-chart-crosshair')).toBeNull()
  })
  it('shows a readable small price without compact subscripts or scientific notation', async () => {
    render(<PriceChart trades={[trade(1, 0.000002162844869)]} symbol="FABS" m={m} />)
    await userEvent.hover(screen.getByRole('button'))
    expect(screen.getByRole('tooltip')).toHaveTextContent('0.000002162844869 OKB')
    expect(screen.getByRole('tooltip').querySelector('strong')).not.toHaveTextContent(/[₀-₉]|e-/)
  })
})
