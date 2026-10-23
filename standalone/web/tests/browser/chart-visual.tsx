// Loopback-only, synthetic visual data. No wallet or external requests.
import '../../src/styles.css'
import '../../src/features/market/tradeMarket.css'
import { useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { TradeChart } from '../../src/features/market/TradeChart'
import { PreferencesProvider } from '../../src/preferences/PreferencesProvider'
import { usePreferences } from '../../src/preferences/context'
if (!import.meta.env.DEV || location.hostname !== '127.0.0.1') throw Error('Local visual fixture only')
globalThis.fetch = async () => { throw Error('No external data in visual fixture') }
const candles = Array.from({length: 96}, (_, i) => {
  const close = 125 + Math.sin(i * .17) * 3 + Math.cos(i * .57) + i * .025
  return {time: 1792252800 + i * 900, end: 1792253700 + i * 900, open: close - Math.sin(i) * .5, high: close + .8, low: close - .8, close, trades: 3}
})
function Fixture(): ReactElement {
  const [mode, setMode] = useState<'line'|'candles'>('line'), {theme, update} = usePreferences()
  return <main style={{maxWidth: 1000, margin: '32px auto', padding: '0 16px'}}>
    <p>本地视觉预览 · 模拟行情 · 无钱包请求</p><button onClick={() => update({theme: theme === 'light' ? 'dark' : 'light'})}>切换主题</button>
    <section className="trade-market-chart-surface"><div className="trade-market-heading"><h2>OKB / USD₮0</h2><span>X Layer · TEST</span></div>
      <TradeChart candles={candles} mode={mode} unit="USD₮0 / OKB" />
      <div className="trade-chart-toolbar"><div><button aria-pressed>15m</button></div><div>{(['line','candles'] as const).map(value => <button key={value} aria-pressed={mode===value} onClick={() => setMode(value)}>{value}</button>)}</div></div>
    </section></main>
}
createRoot(document.getElementById('root')!).render(<PreferencesProvider><Fixture /></PreferencesProvider>)
