import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { formatUnits } from 'viem'
import type { MiningAddress, MiningProductDeployment } from '../../../mining-products'
import { Button, Surface } from '../components/primitives'
import { usePreferences } from '../preferences/context'
import { loadOnlineStatus, requestOnlineCheck, type MiningOnlineJob } from './onlineApi'
import { onlineMessages, onlineReason, type MiningOnlineMessageKey } from './onlineMessages'
import './online.css'

export function AutomationPanel({ deployment: d, token, disabled }: {
  deployment: MiningProductDeployment; token?: MiningAddress; disabled: boolean
}): ReactElement {
  const { locale } = usePreferences(), m = onlineMessages(locale), client = useQueryClient()
  const [busy, setBusy] = useState(false), [queued, setQueued] = useState(false), [error, setError] = useState(false)
  const status = useQuery({ queryKey: ['mining-online-status', d.version], queryFn: () => loadOnlineStatus(d), retry: false, refetchInterval: 10_000 })
  const data = status.data
  const run = async (): Promise<void> => {
    if (busy || disabled || !data?.executionEnabled) return
    setBusy(true); setQueued(false); setError(false)
    try { const r = await requestOnlineCheck(d, token); setQueued(r.executionEnabled) }
    catch { setError(true) }
    finally { setBusy(false); await client.invalidateQueries({ queryKey: ['mining-online-status', d.version] }) }
  }
  const kind: Record<MiningOnlineJob['kind'], MiningOnlineMessageKey> = { sync: 'kindSync', fund: 'kindFund', purchase: 'kindPurchase', conversion: 'kindConversion' }
  const state: Record<string, MiningOnlineMessageKey> = { queued: 'statusQueued', pending: 'statusSubmitted', submitted: 'statusSubmitted',
    success: 'statusSucceeded', succeeded: 'statusSucceeded', confirmed: 'statusSucceeded', failed: 'statusFailed', error: 'statusFailed',
    skipped: 'statusSkipped', noop: 'statusSkipped', running: 'statusRunning', blocked: 'statusBlocked', paused: 'statusBlocked' }
  return <Surface className="mining-online-panel" aria-labelledby="mining-automation-title">
    <header className="mining-online-heading"><div><h2 id="mining-automation-title">{m.automation}</h2><p>{m.automationIntro}</p></div>
      <Button disabled={status.isFetching || busy} onClick={() => void status.refetch()}>{m.refresh}</Button></header>
    {status.isPending && <p role="status">{m.serviceLoading}</p>}
    {status.isError && <p role="alert">{m.onlineServiceUnavailable}</p>}
    {data && <>
      <dl className="mining-online-metrics">
        <div><dt>{m.admission}</dt><dd>{data.admissionEnabled ? m.enabled : m.disabled}</dd></div>
        <div><dt>{m.execution}</dt><dd>{data.executionEnabled ? m.enabled : m.disabled}</dd></div>
        <div><dt>{m.gasBudget}</dt><dd>{formatUnits(BigInt(data.budget.spentWei), 18)} / {formatUnits(BigInt(data.budget.capWei), 18)} TEST-OKB</dd>
          <small>{m.spent} / {m.cap} · {m.reserved} {formatUnits(BigInt(data.budget.reservedWei), 18)}</small></div>
        {data.farm && <><div><dt>{m.miners}</dt><dd>{data.farm.minerCount} / {data.farm.capacity}</dd></div>
          <div><dt>{m.procurement}</dt><dd>{formatUnits(BigInt(data.farm.procurementBudgetFab), 8)} TEST-FAB</dd></div></>}
      </dl>
      <details className="mining-online-addresses"><summary>{m.signer} / {m.keeper}</summary><dl>
        <div><dt>{m.signer}</dt><dd><a href={`https://www.oklink.com/xlayer-test/address/${data.signer}`} target="_blank" rel="noreferrer">{data.signer}</a></dd></div>
        <div><dt>{m.keeper}</dt><dd>{data.keeper ? <a href={`https://www.oklink.com/xlayer-test/address/${data.keeper}`} target="_blank" rel="noreferrer">{data.keeper}</a> : '—'}</dd></div>
      </dl></details>
      {!data.executionEnabled && <p role="status">{m.executionDisabled} {data.reason && onlineReason(data.reason, m)}</p>}
      <Button appearance="primary" disabled={busy || disabled || !data.executionEnabled || status.isError} onClick={() => void run()}>{busy ? m.statusRunning : m.queue}</Button>
    </>}
    {queued && <p role="status">{m.queued}</p>}{error && <p role="alert">{m.onlineServiceUnavailable}</p>}
    {data && <div className="mining-online-jobs"><h3>{m.jobs}</h3>
      {!data.jobs.length ? <p className="dialog-note">{m.noJobs}</p> : <ol>{data.jobs.map((job) => <li key={job.id}>
        <div className="mining-online-job-title"><strong>{m[kind[job.kind]]}</strong><span>{m[state[job.status] ?? 'statusUnknown']}</span></div>
        {job.reason && <p>{onlineReason(job.reason, m)}</p>}
        {job.token && <p className="mining-online-address">{m.jobToken}: {job.token}</p>}
        {job.hash && <a href={`https://www.oklink.com/xlayer-test/tx/${job.hash}`} target="_blank" rel="noreferrer">{m.transaction} ↗</a>}
        <small>{m.updated} <time dateTime={new Date(job.updatedAt).toISOString()}>{new Date(job.updatedAt).toLocaleString(locale)}</time></small>
      </li>)}</ol>}
    </div>}
  </Surface>
}
