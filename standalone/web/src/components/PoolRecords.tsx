import type { ReactElement } from 'react'
import { EXPLORER_URL, shortenAddress } from '../domain/assets'
import { usePreferences } from '../preferences/context'
import { POOLS, V4_POOL_ID } from '../trading/config'
export const POOL_SEARCH_TEXT = `OKB WOKB USD₮0 usdt0 V3 V4 ${POOLS.v3Address ?? ''} ${V4_POOL_ID}`.toLowerCase()
export function PoolRecords(): ReactElement {
  const { t } = usePreferences()
  return (
    <div className="pool-records">
      <article className="pool-record">
        <h3>V3 · WOKB / USD₮0 · 0.01%</h3>
        <p>{t('poolAddress')}</p>
        <a href={`${EXPLORER_URL}/address/${POOLS.v3Address}`} target="_blank" rel="noreferrer">
          {shortenAddress(POOLS.v3Address ?? '')}
        </a>
      </article>
      <article className="pool-record">
        <h3>V4 · OKB / USD₮0 · 0%</h3>
        <p>{t('poolId')}</p>
        <code>{V4_POOL_ID}</code>
      </article>
    </div>
  )
}
