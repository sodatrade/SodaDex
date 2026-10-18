import { useInfiniteQuery } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { Button } from '../../components/primitives'
import { Pagination, usePagination } from '../../components/Pagination'
import { CHAIN_ID, EXPLORER_URL, shortenAddress } from '../../domain/assets'
import { orderMessages } from '../../i18n/orders'
import type { WalletController } from '../../lib/useWallet'
import type { Currency } from '../../liquidity/types'
import { usePreferences } from '../../preferences/context'
import { listOrders, type PublicOrder } from './api'
import type { OrderDeployment } from './config'
import { OrderDetails } from './OrderDetails'
import { OrderReview } from './OrderReview'
import type { LimitOperation, LimitReview } from './useLimitOperation'
export function OrderList({ wallet, deployment, ready, operation, currencies, active = true }: {
  wallet: WalletController; deployment?: OrderDeployment; ready: boolean; operation: LimitOperation; currencies: Currency[]; active?: boolean
}): ReactElement {
  const { locale } = usePreferences(), m = orderMessages(locale), [review, setReview] = useState<LimitReview>()
  const maker = wallet.session?.chainId === CHAIN_ID ? wallet.session.address : undefined
  const query = useInfiniteQuery({ queryKey: ['limit-orders', maker, deployment?.settlement], initialPageParam: undefined as string | undefined,
    enabled: !!maker && !!deployment && ready && active, retry: false, queryFn: ({ pageParam }) => listOrders(maker!, deployment!, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined })
  const orders = new Map<string, PublicOrder>()
  if (!query.isError) for (const page of query.data?.pages ?? []) for (const order of page.orders) orders.set(order.id, order)
  const pagination = usePagination([...orders.values()], `${maker?.toLowerCase() ?? ''}:${deployment?.settlement ?? ''}`)
  return <section className="order-list" aria-label={m.orders}><div className="order-list-heading"><h3>{m.orders}</h3>
    <Button onClick={() => void query.refetch()} disabled={!ready || !maker || query.isFetching}>{m.refresh}</Button></div>
    {!maker ? <p className="order-note">{m.connect}</p> : !ready ? <p className="order-note">{m.notReady}</p> : query.isError ? <p role="alert">{m.unavailable}</p>
      : query.isPending ? <p role="status">{m.loading}</p> : !orders.size ? <p className="order-note">{m.empty}</p> : pagination.items.map((entry) => <article key={entry.id} className="order-record">
        <details><summary><span>{shortenAddress(entry.id)}</span><strong>{m[entry.status]}</strong></summary><OrderDetails order={entry.order} currencies={currencies} />
          <p className="order-id">{entry.id}</p>{entry.reason && <p>{m.reason}: {m[entry.reason]}</p>}
          {entry.observation && <p className="order-note">{m.observed}: #{entry.observation.blockNumber} · {new Date(entry.observation.timestamp * 1000).toLocaleString(locale)}<br /><span className="order-id">{entry.observation.blockHash}</span></p>}
          {entry.txHash && <a className="transaction-link" href={`${EXPLORER_URL}/tx/${entry.txHash}`} target="_blank" rel="noreferrer">{m.tx}</a>}
        </details>
        {['open', 'pending'].includes(entry.status) && <Button disabled={!ready || operation.busy || operation.unresolved || entry.order.maker.toLowerCase() !== maker?.toLowerCase()}
          onClick={() => { const identity = wallet.getIdentity(); if (identity) setReview(operation.review(entry.order, identity)) }}>{m.cancel}</Button>}
      </article>)}
    {maker && ready && !query.isError && <Pagination {...pagination} />}
    {maker && ready && query.hasNextPage && !query.isError && pagination.page + 1 === pagination.pages && <Button onClick={() => void query.fetchNextPage()} disabled={query.isFetching}>{m.more}</Button>}
    {review && <OrderReview review={review} operation={operation} currencies={currencies} ready={ready} cancel onClose={() => { operation.changed(); setReview(undefined) }} />}
  </section>
}
