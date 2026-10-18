import { useState, type ReactElement, type ReactNode } from 'react'
import { Icon } from '../../components/primitives'
import type { AssetId } from '../../domain/assets'
import type { WalletController } from '../../lib/useWallet'
import { usePreferences } from '../../preferences/context'
import { POOLS } from '../../trading/config'
import { TradeMarketPanel } from '../market/TradeMarketPanel'
import { GeneralSwapCard } from '../swap/GeneralSwapCard'
import type { TradeMarketContext } from './context'
export interface TradeWorkspaceProps {
  wallet: WalletController; balances: Record<AssetId, bigint> | undefined; balancesLoading: boolean; balancesError: boolean
  onConnect: () => void; onCreatePool?: () => void; active?: boolean
  activeMode?: 'swap' | 'limit'; orderMarketContext?: TradeMarketContext; orderModeControl?: ReactNode; renderOrderPanel?: (context: TradeMarketContext) => ReactNode
}
export function TradeWorkspace({ active = true, activeMode = 'swap', orderMarketContext, orderModeControl, renderOrderPanel, ...swapProps }: TradeWorkspaceProps): ReactElement {
  const { t } = usePreferences(), [context, setContext] = useState<TradeMarketContext>()
  return <div className="dex-workspace">
    <div className="trade-terminal">
      <div className={`trade-order-column${orderModeControl ? ' has-order-modes' : ''}`}>
        {orderModeControl && <div className="trade-mode-bar">{orderModeControl}</div>}
        <div hidden={activeMode !== 'swap'}><GeneralSwapCard {...swapProps} onContextChange={setContext} /></div>
        {activeMode === 'limit' && context && renderOrderPanel?.(context)}
        <div className="trade-meta"><span><Icon name="layers" size={15} />{t(POOLS.ready ? 'poolsReady' : 'deploymentPending')}</span><span>{t('platformZero')}</span></div>
      </div>
      <TradeMarketPanel context={activeMode === 'limit' ? orderMarketContext ?? context : context} active={active} />
    </div>
  </div>
}
export type { TradeMarketContext } from './context'
