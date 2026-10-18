import type { ReactElement } from 'react'
import type { ChainIndexStatus } from '../data/indexStatus'
import { indexMessages } from '../i18n/indexing'
import { usePreferences } from '../preferences/context'

export function IndexProgress({ status }: { status?: ChainIndexStatus }): ReactElement | null {
  const { locale } = usePreferences(), m = indexMessages(locale)
  if (!status) return null
  return <p className="data-muted" role="status">
    {status.lastError ? m.lag : status.syncing ? m.syncing : m.synced}
    {' · '}{m.through} #{status.indexedThrough}{status.head && <> / #{status.head.number}</>}
  </p>
}
