import type { ReactElement } from 'react'
import { formatUnits } from 'viem'
import { EXPLORER_URL, shortenAddress } from '../../domain/assets'
import { tradeMessages } from '../../i18n/trade'
import { LP_CONTRACTS } from '../../liquidity/config'
import { usePreferences } from '../../preferences/context'
import { poolTradeCurrencies, type PoolTradeQuote } from '../../trading/poolTrade'
import { priceImpact } from './routes'
export function TradeDetails({ quote }: { quote: PoolTradeQuote }): ReactElement {
  const { locale } = usePreferences(), m = tradeMessages(locale)
  const [from, to] = poolTradeCurrencies(quote)
  const link = quote.pool.protocol === 'v3' ? quote.pool.address : LP_CONTRACTS.poolManager
  return <dl className="review-details swap-details">
    <div><dt>{m.minimum}</dt><dd title={formatUnits(quote.minimumOut, to.decimals)}>{formatUnits(quote.minimumOut, to.decimals)} {to.symbol}</dd></div>
    <div><dt>{m.slippage}</dt><dd>{quote.slippageBps / 100}%</dd></div>
    <div><dt title={m.impactNote}>{m.impact}</dt><dd>{priceImpact(quote) ?? m.unknown}</dd></div>
    <div><dt>{m.fee}</dt><dd>{quote.pool.protocol.toUpperCase()} · {quote.pool.fee / 10000}%</dd></div>
    <div><dt>{m.feeAmount}</dt><dd>{formatUnits(quote.amount * BigInt(quote.pool.fee) / 1000000n, from.decimals)} {from.symbol}</dd></div>
    <div><dt>{m.pool}</dt><dd><a href={`${EXPLORER_URL}/address/${link}`} target="_blank" rel="noreferrer">{shortenAddress(quote.pool.id)}</a></dd></div>
  </dl>
}
