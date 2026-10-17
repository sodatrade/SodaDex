import { useQuery } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { formatUnits } from 'viem'
import type { MiningAddress, MiningProductDeployment, MiningProject } from '../../../mining-products'
import type { MiningWriteRole } from '../../../mining-calls'
import { Button, Surface } from '../components/primitives'
import { rpc } from '../lib/readRpc'
import { usePreferences } from '../preferences/context'
import { miningMessages } from './messages'
import { miningUint, productRead } from './protocol'
import { simpleMiningPlan, type MiningPlan } from './plans'

export function MiningRewardsPanel({ deployment: d, account, project, disabled, onPlan }: {
  deployment: MiningProductDeployment; account?: MiningAddress; project?: MiningProject; disabled: boolean
  onPlan: (plan: MiningPlan) => void
}): ReactElement {
  const { locale } = usePreferences(), m = miningMessages(locale)
  const sources = [
    { name: m.fragmentRewards, to: d.contracts.fragmentVault.address, role: 'fragmentVault' as const },
    { name: m.lpRewards, to: d.contracts.fragmentPool.address, role: 'fragmentPool' as const },
    ...(project ? [{ name: m.projectRewards, to: project.holder.address, role: 'holder' as const }] : []),
  ]
  const rewards = useQuery({ queryKey: ['mining-rewards', d.version, account, project?.token.address], enabled: !!account,
    queryFn: async () => Promise.all(sources.map(async (s) => miningUint(await productRead(rpc, s.to, s.role, 'claimable', [account!])))),
    retry: false, refetchInterval: 15_000 })
  const plan = (to: MiningAddress, role: MiningWriteRole, name: string, args: readonly unknown[] = []): void => {
    if (account) {
      const label = name === 'sync' && role === 'projectVault' ? 'taxSync' : name === 'fundFarm' ? 'fund'
        : name === 'syncPaid' ? 'sync' : name === 'syncHistory' || name === 'syncVault' ? 'catchup' : name
      const pending = simpleMiningPlan(account, to, role, label, name, args)
      const index = sources.findIndex((s) => s.to === to)
      if (name === 'claim' && index >= 0 && rewards.data) pending.details.push({ label: 'output', value: `${formatUnits(rewards.data[index], 8)} TEST-FAB` })
      onPlan(pending)
    }
  }
  return <div className="mining-rewards-grid">
    {sources.map((s, index) => <Surface key={s.to} className="mining-action-card">
      <h2>{s.name}</h2><p className="mining-reward-value">{rewards.data ? formatUnits(rewards.data[index], 8) : '—'} <small>TEST-FAB</small></p>
      <p className="dialog-note">{m.dividendNote}</p>
      <div className="mining-button-row">
        <Button appearance="primary" disabled={disabled || !account || !rewards.data || rewards.data[index] === 0n}
          onClick={() => plan(s.to, s.role, 'claim')}>{m.claim}</Button>
        <Button disabled={disabled || !account} onClick={() => plan(s.to, s.role, 'harvest')}>{m.harvest}</Button>
        {s.role !== 'fragmentVault' && <Button disabled={disabled || !account} onClick={() => plan(s.to, s.role, 'syncPaid')}>{m.sync}</Button>}
        {s.role === 'holder' && <Button disabled={disabled || !account} onClick={() => plan(s.to, s.role, 'syncHistory', [16n])}>{m.catchup}</Button>}
      </div>
    </Surface>)}
    {project && <Surface className="mining-action-card"><h2>{m.fundraising}</h2><div className="mining-button-row">
      <Button disabled={disabled || !account} onClick={() => plan(project.vault.address, 'projectVault', 'sync')}>{m.taxSync}</Button>
      <Button disabled={disabled || !account} onClick={() => plan(project.vault.address, 'projectVault', 'fundFarm')}>{m.fund}</Button>
      <Button disabled={disabled || !account} onClick={() => plan(d.contracts.farm.address, 'farm', 'syncVault', [project.vault.address])}>{m.catchup}</Button>
    </div></Surface>}
    {rewards.isError && <p role="alert">{m.unavailable}</p>}
  </div>
}
