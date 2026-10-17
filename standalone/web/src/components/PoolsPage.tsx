import type { ReactElement } from 'react'
import { usePreferences } from '../preferences/context'
import { POOLS } from '../trading/config'
import { PoolRecords } from './PoolRecords'
import { Button, Icon, Surface } from './primitives'

export function PoolsPage({ onSwap }: { onSwap: () => void }): ReactElement {
  const { t } = usePreferences()
  return (
    <section className="content-page" aria-labelledby="pools-title">
      <div className="page-heading">
        <span className="eyebrow">{t('poolsEyebrow')}</span>
        <h1 id="pools-title">{t('poolsTitle')}</h1>
        <p>{t(POOLS.ready ? 'poolReadyNote' : 'poolsDescription')}</p>
      </div>
      <Surface className="pools-surface">
        {POOLS.ready ? (
          <PoolRecords />
        ) : (
          <>
            <div className="pool-illustration" aria-hidden="true">
              <span />
              <Icon name="layers" size={42} />
              <span />
            </div>
            <h2>{t('poolsEmptyTitle')}</h2>
            <p>{t('poolsEmptyDescription')}</p>
          </>
        )}
        <div className="pool-fees">
          <div>
            <span>{t('v3PlannedFee')}</span>
            <strong>
              0.01<span>%</span>
            </strong>
          </div>
          <div>
            <span>{t('v4PlannedFee')}</span>
            <strong>
              0<span>%</span>
            </strong>
          </div>
          <div>
            <span>{t('platformProtocolFee')}</span>
            <strong>
              0<span>%</span>
            </strong>
          </div>
        </div>
        <Button onClick={onSwap}>
          {t('backToSwap')}
          <Icon name="arrow" size={16} />
        </Button>
      </Surface>
    </section>
  )
}
