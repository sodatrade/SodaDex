import type { ReactElement, ReactNode } from 'react'
import { formatUnits } from 'viem'
import { Pagination, usePagination } from '../../components/Pagination'
import type { LiquidityText } from '../../i18n/liquidity'
import type { LiquidityPool } from '../../liquidity/types'
import { CurrencyLabel } from './CurrencyLabel'
import { PoolManageButton } from './PoolManageButton'

export function PoolList({ pools, l, disabled, onDetails, extraRows = [] }: {
  pools: LiquidityPool[]
  l: LiquidityText
  disabled: boolean
  onDetails: (pool: LiquidityPool) => void
  extraRows?: { id: string; content: ReactNode }[]
}): ReactElement {
  const rows: ({ id: string; pool: LiquidityPool } | { id: string; content: ReactNode })[] = [...extraRows, ...pools.map(pool => ({ id: `${pool.protocol}:${pool.id}`, pool }))]
  const pagination = usePagination(rows)
  return <><div className="lp-pool-list" role="table" aria-label={l('pools')}>
    <div className="lp-pool-heading" role="row">
      <span role="columnheader">{l('pair')}</span>
      <span role="columnheader">{l('protocol')} · {l('fee')}</span>
      <span role="columnheader">{l('status')}</span>
      <span role="columnheader">{l('action')}</span>
    </div>
    {pagination.items.map(row => { if ('content' in row) return <div key={row.id}>{row.content}</div>; const pool = row.pool; return <div className="lp-pool" role="row" key={row.id}>
      <div className="lp-pair" role="cell">
        <CurrencyLabel currency={pool.currency0} /><span>/</span><CurrencyLabel currency={pool.currency1} />
      </div>
      <span className="lp-pool-protocol" role="cell">{pool.protocol.toUpperCase()} · {formatUnits(BigInt(pool.fee), 4)}%</span>
      <span className="lp-pool-status" role="cell">{l(pool.initialized ? 'initialized' : 'notInitialized')}</span>
      <div className="lp-actions" role="cell">
        <PoolManageButton label={l('manage')} onClick={() => onDetails(pool)} disabled={disabled} />
      </div>
    </div>})}
  </div><Pagination {...pagination} /></>
}
