import { formatUnits, zeroAddress } from 'viem'
import type { ReactElement } from 'react'
import type { SodaLimitOrder } from '../../../../order-types'
import type { Currency } from '../../liquidity/types'
import { orderMessages } from '../../i18n/orders'
import { usePreferences } from '../../preferences/context'
export function OrderDetails({ order, currencies }: { order: SodaLimitOrder; currencies: Currency[] }): ReactElement {
  const { locale } = usePreferences(), m = orderMessages(locale)
  const currency = (address: string): Currency | undefined => currencies.find((c) => address.toLowerCase() === zeroAddress ? c.native : !c.native && c.address.toLowerCase() === address.toLowerCase())
  const amount = (raw: string, address: string): string => { const c = currency(address); return c ? `${formatUnits(BigInt(raw), c.decimals)} ${c.symbol}` : `${raw} raw · ${address}` }
  return <dl className="order-details"><div><dt>{m.amount}</dt><dd>{amount(order.amountIn, order.inputToken)}</dd></div>
    <div><dt>{m.receive}</dt><dd>{amount(order.minAmountOut, order.outputToken)}</dd></div>
    <div><dt>{m.expiry}</dt><dd>{new Date(Number(order.expiry) * 1000).toLocaleString(locale)}</dd></div>
    <div><dt>{m.pool}</dt><dd>V{order.protocol} · {order.pool.fee / 10000}% · {order.pool.tickSpacing}</dd></div>
    <div><dt>{m.input}</dt><dd>{order.inputToken}</dd></div><div><dt>{m.output}</dt><dd>{order.outputToken}</dd></div>
    <div><dt>{m.poolKey}</dt><dd>{order.pool.currency0} / {order.pool.currency1}<br />{order.pool.hooks}</dd></div>
    <div><dt>{m.receiver}</dt><dd>{order.receiver}</dd></div><div><dt>{m.settlement}</dt><dd>{order.settlement}</dd></div>
    <div><dt>{m.nonce}</dt><dd>{order.nonce}</dd></div></dl>
}
