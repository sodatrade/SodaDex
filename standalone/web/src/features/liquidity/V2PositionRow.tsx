import type { ReactElement } from 'react'
import { formatUnits } from 'viem'
import type { V2Position } from '../../liquidity/v2Types'
import type { LiquidityText } from '../../i18n/liquidity'
import { PoolManageButton } from './PoolManageButton'

export function V2PositionRow({ position, l, disabled, onManage }: { position: V2Position; l: LiquidityText; disabled: boolean; onManage: () => void }): ReactElement {
  const p = position.pool
  return <div className="lp-pool">
    <div className="lp-pair"><strong>{p.currency0.symbol} / {p.currency1.symbol}</strong><span className="lp-pill">V2</span></div>
    <span>{formatUnits(position.balance, 18)} LP</span>
    <span className="lp-muted">0.3%</span>
    <div className="lp-actions"><PoolManageButton label={l('manage')} disabled={disabled} onClick={onManage} /></div>
  </div>
}
