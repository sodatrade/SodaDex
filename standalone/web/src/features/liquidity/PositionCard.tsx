import type { ReactElement } from 'react'
import { Button, Icon, Surface } from '../../components/primitives'
import { EXPLORER_URL } from '../../domain/assets'
import type { LiquidityText } from '../../i18n/liquidity'
import { LP_CONTRACTS } from '../../liquidity'
import type { LiquidityPosition } from '../../liquidity/types'
import { CurrencyLabel } from './CurrencyLabel'
import { tokenAmount } from './presentation'
export function PositionCard({
  position,
  l,
  disabled,
  onAction,
}: {
  position: LiquidityPosition
  l: LiquidityText
  disabled: boolean
  onAction: (kind: 'increase' | 'decrease' | 'collect' | 'transfer' | 'burn') => void
}): ReactElement {
  const pool = position.pool,
    manager = pool.protocol === 'v3' ? LP_CONTRACTS.v3Manager : LP_CONTRACTS.v4Manager
  return (
    <Surface className="lp-position">
      <div className="lp-row-heading">
        <div className="lp-pair">
          <CurrencyLabel currency={pool.currency0} />
          <span>/</span>
          <CurrencyLabel currency={pool.currency1} />
        </div>
        <span className="lp-pill">
          {pool.protocol.toUpperCase()} · #{position.tokenId.toString()}
        </span>
      </div>
      <p className={`lp-range-status${position.liquidity > 0n && position.inRange ? ' is-in-range' : ''}`}>
        {l(position.liquidity === 0n ? 'closed' : position.inRange ? 'inRange' : 'outRange')}
      </p>
      <dl className="lp-review lp-position-values">
        <div>
          <dt>{l('position')}</dt>
          <dd>
            {tokenAmount(position.amount0, pool.currency0)}
            <br />
            {tokenAmount(position.amount1, pool.currency1)}
          </dd>
        </div>
        <div>
          <dt>{l('claimable')}</dt>
          <dd>
            {tokenAmount(position.claimable0, pool.currency0)}
            <br />
            {tokenAmount(position.claimable1, pool.currency1)}
          </dd>
        </div>
        <div>
          <dt>{l('ticks')}</dt>
          <dd>
            {position.tickLower} → {position.tickUpper}
          </dd>
        </div>
      </dl>
      <div className="lp-actions">
        <Button onClick={() => onAction('increase')} disabled={disabled}>
          {l('increase')}
        </Button>
        <Button onClick={() => onAction('decrease')} disabled={disabled || position.liquidity === 0n}>
          {l('decrease')}
        </Button>
        <Button
          onClick={() => onAction('collect')}
          disabled={disabled || (position.claimable0 === 0n && position.claimable1 === 0n)}
        >
          {l('collect')}
        </Button>
      </div>
      <div className="lp-position-secondary">
        <Button appearance="ghost" onClick={() => onAction('transfer')} disabled={disabled}>{l('transfer')}</Button>
        {position.liquidity === 0n && position.claimable0 === 0n && position.claimable1 === 0n &&
          <Button appearance="ghost" onClick={() => onAction('burn')} disabled={disabled}>{l('burn')}</Button>}
        <a
          className="lp-nft-link"
          href={`${EXPLORER_URL}/nft/${manager}/${position.tokenId}`}
          target="_blank"
          rel="noreferrer"
        >
          {l('nft')} · #{position.tokenId.toString()}
          <Icon name="external" size={14} />
        </a>
      </div>
    </Surface>
  )
}
