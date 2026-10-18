import type { ReactElement } from 'react'
import { formatUnits } from 'viem'
import { Button, Icon } from '../../components/primitives'
import { Pagination, usePagination } from '../../components/Pagination'
import { formatBalance } from '../../domain/amount'
import { EXPLORER_URL } from '../../domain/assets'
import { workspaceMessages } from '../../i18n/workspace'
import { LP_CONTRACTS, type LiquidityPosition } from '../../liquidity'
import { usePreferences } from '../../preferences/context'
import { CurrencyLabel } from '../liquidity/CurrencyLabel'
export function PortfolioPositions({ positions, onManage }: { positions: LiquidityPosition[]; onManage: () => void }): ReactElement {
  const { locale } = usePreferences(), m = workspaceMessages(locale)
  const pagination = usePagination(positions)
  return <><div className="portfolio-position-list">{pagination.items.map((position) => {
    const pool = position.pool, manager = pool.protocol === 'v3' ? LP_CONTRACTS.v3Manager : LP_CONTRACTS.v4Manager
    return <article className="portfolio-position" key={`${pool.protocol}:${position.tokenId}`}>
      <div className="portfolio-position-main"><span className="portfolio-nft-number">{pool.protocol.toUpperCase()} #{position.tokenId.toString()}</span>
        <h3><CurrencyLabel currency={pool.currency0} /><span>/</span><CurrencyLabel currency={pool.currency1} /></h3>
        <p className="portfolio-muted">SodaDEX · {m[position.liquidity > 0n ? 'activePosition' : 'closedPosition']}</p></div>
      <div className="portfolio-position-amounts">{([0, 1] as const).map((index) => {
        const currency = index === 0 ? pool.currency0 : pool.currency1, amount = index === 0 ? position.amount0 : position.amount1
        return <span key={index} title={formatUnits(amount, currency.decimals)}>{formatBalance(amount, currency.decimals)} {currency.symbol}</span>
      })}</div>
      <div className="portfolio-position-actions"><Button onClick={onManage}>{m.manage}</Button>
        <a href={`${EXPLORER_URL}/nft/${manager}/${position.tokenId}`} target="_blank" rel="noreferrer">{m.viewNft}<Icon name="external" size={14} /></a></div>
    </article>
  })}</div><Pagination {...pagination} /></>
}
