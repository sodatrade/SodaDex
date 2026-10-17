import type { ReactElement } from 'react'
import { formatUnits } from 'viem'
import { Dialog } from '../../components/Dialog'
import { Button } from '../../components/primitives'
import { EXPLORER_URL } from '../../domain/assets'
import type { LiquidityText } from '../../i18n/liquidity'
import type { LiquidityPool } from '../../liquidity/types'
import { CurrencyLabel } from './CurrencyLabel'
import { PoolQuotePanel } from './PoolQuotePanel'
export function PoolDetailDialog({
  pool,
  l,
  disabled,
  onAdd,
  onClose,
}: {
  pool: LiquidityPool
  l: LiquidityText
  disabled: boolean
  onAdd: () => void
  onClose: () => void
}): ReactElement {
  return (
    <Dialog title={l('details')} description={l('test')} onClose={onClose}>
      <div className="lp-pair">
        <CurrencyLabel currency={pool.currency0} />
        <span>/</span>
        <CurrencyLabel currency={pool.currency1} />
        <span className="lp-pill">{pool.protocol.toUpperCase()}</span>
      </div>
      <dl className="lp-review">
        <div>
          <dt>{l('fee')}</dt>
          <dd>{formatUnits(BigInt(pool.fee), 4)}%</dd>
        </div>
        <div>
          <dt>{l('poolId')}</dt>
          <dd className="lp-code">{pool.id}</dd>
        </div>
        {pool.address && (
          <div>
            <dt>{l('poolAddress')}</dt>
            <dd className="lp-code">
              <a href={`${EXPLORER_URL}/address/${pool.address}`} target="_blank" rel="noreferrer">
                {pool.address}
              </a>
            </dd>
          </div>
        )}
      </dl>
      <p className="lp-muted">{l(pool.initialized ? 'initialized' : 'notInitialized')}</p>
      {pool.initialized && <PoolQuotePanel pool={pool} />}
      {pool.initialized && (
        <details className="lp-import">
          <summary>{l('advanced')}</summary>
          <dl className="lp-review">
            <div>
              <dt>{l('currentTick')}</dt>
              <dd>{pool.tick}</dd>
            </div>
            <div>
              <dt>{l('liquidity')}</dt>
              <dd>{pool.liquidity.toString()}</dd>
            </div>
            <div>
              <dt>{l('tickSpacing')}</dt>
              <dd>{pool.tickSpacing}</dd>
            </div>
            <div>
              <dt>{l('sqrtPrice')}</dt>
              <dd className="lp-code">{pool.sqrtPriceX96.toString()}</dd>
            </div>
          </dl>
        </details>
      )}
      <Button appearance="primary" className="lp-full-width" onClick={onAdd} disabled={disabled}>
        {l('add')}
      </Button>
    </Dialog>
  )
}
