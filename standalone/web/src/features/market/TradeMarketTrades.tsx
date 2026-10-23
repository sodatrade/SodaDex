import type { ReactElement } from 'react'
import { formatUnits } from 'viem'
import { Icon } from '../../components/primitives'
import { Pagination, usePagination } from '../../components/Pagination'
import { EXPLORER_URL, shortenAddress } from '../../domain/assets'
import { tradeMarketMessages } from '../../i18n/tradeMarket'
import { usePreferences } from '../../preferences/context'
import type { TradeMarketContext } from '../trade/context'
import type { ChartResponse } from './api'
import { directionalPrice } from './marketModel'
import { formatPrice } from './TradeChart'
export function TradeMarketTrades({ data, context }: { data: ChartResponse; context: TradeMarketContext }): ReactElement {
  const { locale } = usePreferences(), m = tradeMarketMessages(locale), reverse = context.zeroForOne === false
  const fromDecimals = reverse ? data.token1.decimals : data.token0.decimals, toDecimals = reverse ? data.token0.decimals : data.token1.decimals
  const pagination = usePagination([...data.trades].reverse(), `${data.pool.protocol}:${data.pool.id}:${data.query.fromBlock}:${data.query.toBlock}`)
  const rows = pagination.items
  return <section className="trade-market-activity" aria-label={m.recent}><div className="trade-market-section-heading"><h3>{m.recent}</h3><span>{pagination.start}–{pagination.end} / {pagination.total}</span></div>
    {!rows.length ? <p className="trade-market-muted">{m.noTrades}</p> : <div className="trade-market-table-scroll"><table><thead><tr><th>{m.time}</th><th>{m.price} · {context.to.symbol}/{context.from.symbol}</th>
      <th>{context.from.symbol}</th><th>{context.to.symbol}</th><th>{m.transaction}</th></tr></thead><tbody>{rows.map((trade) => {
        const from = reverse ? trade.volume1Raw : trade.volume0Raw, to = reverse ? trade.volume0Raw : trade.volume1Raw
        return <tr key={trade.id}><td>{new Date(trade.timestamp * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
          <td>{formatPrice(directionalPrice(trade.priceToken1PerToken0, reverse), locale)}</td>
          <td title={fromDecimals === null ? from : formatUnits(BigInt(from), fromDecimals)}>{fromDecimals === null ? '—' : formatUnits(BigInt(from), fromDecimals)}</td>
          <td title={toDecimals === null ? to : formatUnits(BigInt(to), toDecimals)}>{toDecimals === null ? '—' : formatUnits(BigInt(to), toDecimals)}</td>
          <td><a href={`${EXPLORER_URL}/tx/${trade.transactionHash}`} target="_blank" rel="noreferrer">{shortenAddress(trade.transactionHash)}<Icon name="external" size={12} /></a></td></tr>
      })}</tbody></table></div>}
    <Pagination {...pagination} />
  </section>
}
