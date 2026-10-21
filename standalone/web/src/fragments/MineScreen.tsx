import type { ReactElement } from 'react'
import { formatEther } from 'viem'
import { formatBalance } from './format'
import type { ScreenProps } from './types'
export function MineScreen({ snapshot: s, account, m }: ScreenProps): ReactElement {
  const ownedShares = s.lpSupply > 0n ? s.shares * s.lpBalance / s.lpSupply : 0n
  const ownedOkb = s.lpSupply > 0n ? s.okb * s.lpBalance / s.lpSupply : 0n
  return <div className="fragment-stack"><section className="fragment-card"><h2>{m.balances}</h2>
    <div className="fragment-stats">{[['OKB', s.okbBalance], ['sFAB', s.shareBalance]].map(([label, value]) => <div key={String(label)}><span>{String(label)}</span><strong title={account ? formatEther(value as bigint) : undefined}>{account ? formatBalance(value as bigint) : '—'}</strong></div>)}</div>
  </section><section className="fragment-card"><h2>{m.lpAmount}</h2><p>{m.principal}</p>
    <div className="fragment-stats">{[['LP', s.lpBalance], ['OKB', ownedOkb], ['sFAB', ownedShares]].map(([label, value]) => <div key={String(label)}><span>{String(label)}</span><strong title={account ? formatEther(value as bigint) : undefined}>{account ? formatBalance(value as bigint) : '—'}</strong></div>)}</div>
    <p className="fragment-muted">{m.ignixScope}</p>
  </section></div>
}
