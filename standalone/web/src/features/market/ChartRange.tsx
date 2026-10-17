import { useState, type ReactElement } from 'react'
import { Button } from '../../components/primitives'
import { tradeMarketMessages } from '../../i18n/tradeMarket'
import { usePreferences } from '../../preferences/context'
export function ChartRange({ onApply }: { onApply: (range?: { fromBlock: number; toBlock: number }) => void }): ReactElement {
  const { locale } = usePreferences(), m = tradeMarketMessages(locale)
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [error, setError] = useState(false)
  return <details className="trade-chart-range"><summary>{m.range}</summary><form onSubmit={(event) => {
    event.preventDefault()
    if (!from && !to) { onApply(undefined); setError(false); return }
    const fromBlock = Number(from), toBlock = Number(to)
    if (!/^\d+$/.test(from) || !/^\d+$/.test(to) || !Number.isSafeInteger(fromBlock) || !Number.isSafeInteger(toBlock) || fromBlock > toBlock) { setError(true); return }
    setError(false); onApply({ fromBlock, toBlock })
  }}><label>{m.fromBlock}<input inputMode="numeric" value={from} placeholder={m.fromDeployment} onChange={(event) => setFrom(event.target.value)} /></label>
    <label>{m.toBlock}<input inputMode="numeric" value={to} placeholder={m.latest} onChange={(event) => setTo(event.target.value)} /></label>
    <Button type="submit">{m.apply}</Button></form>{error && <p className="error-text" role="alert">{m.rangeError}</p>}</details>
}
