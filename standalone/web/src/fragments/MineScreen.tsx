import { useEffect, useState, type ReactElement } from 'react'
import { formatEther } from 'viem'
import { Dialog } from '../components/Dialog'
import { Button, Icon } from '../components/primitives'
import { Pagination, usePagination } from '../components/Pagination'
import { NETWORK } from '../network'
import { formatBalance } from './format'
import type { ScreenProps } from './types'
export function MineScreen({ snapshot: s, account, deployment, m }: ScreenProps): ReactElement {
  const [selected, setSelected] = useState<'OKB' | 'sFAB' | 'LP'>()
  useEffect(() => setSelected(undefined), [account])
  const ownedShares = s.lpSupply > 0n ? s.shares * s.lpBalance / s.lpSupply : 0n
  const ownedOkb = s.lpSupply > 0n ? s.okb * s.lpBalance / s.lpSupply : 0n
  const assets = usePagination([{ symbol: 'OKB' as const, balance: s.okbBalance }, { symbol: 'sFAB' as const, balance: s.shareBalance }], account)
  const positions = usePagination([{ pair: 'OKB / sFAB', lp: s.lpBalance }], account)
  const amount = (value: bigint): ReactElement => <span title={account ? formatEther(value) : undefined}>{account ? formatBalance(value) : '—'}</span>
  const details = (label: string, onClick: () => void): ReactElement => <Button aria-label={`${m.details} ${label}`} aria-haspopup="dialog" disabled={!account} onClick={onClick}>{m.details}<Icon name="chevron" size={14} /></Button>
  const address = selected === 'LP' ? deployment.pool : selected === 'sFAB' ? deployment.vault : undefined
  const selectedBalance = selected === 'LP' ? s.lpBalance : selected === 'sFAB' ? s.shareBalance : s.okbBalance
  return <div className="fragment-stack">
    <section className="fragment-card fragment-account-section"><h2>{m.balances}</h2>
      <div className="fragment-table fragment-account-table"><table aria-label={m.balances}><thead><tr><th>{m.asset}</th><th>{m.balance}</th><th><span className="sr-only">{m.details}</span></th></tr></thead>
        <tbody>{assets.items.map(asset => <tr key={asset.symbol}><td><strong>{asset.symbol}</strong></td><td>{amount(asset.balance)}</td><td>{details(asset.symbol, () => setSelected(asset.symbol))}</td></tr>)}</tbody>
      </table></div><Pagination {...assets} />
      {s.vaultClaimable !== undefined && <p className="fragment-muted">{m.vaultIncome}: {amount(s.vaultClaimable)} FAB · {m.vaultIncomeHint}</p>}
    </section>
    <section className="fragment-card fragment-account-section"><h2>{m.lpPositions}</h2><p className="fragment-muted">{m.principal}</p>
      <div className="fragment-table fragment-account-table"><table aria-label={m.lpPositions}><thead><tr><th>{m.pair}</th><th>{m.lpAmount}</th><th><span className="sr-only">{m.details}</span></th></tr></thead>
        <tbody>{positions.items.map(position => <tr key={position.pair}><td><strong>{position.pair}</strong></td><td>{amount(position.lp)}</td><td>{details(position.pair, () => setSelected('LP'))}</td></tr>)}</tbody>
      </table></div><Pagination {...positions} /><p className="fragment-muted">{m.ignixScope}</p>
    </section>
    {selected && account && <Dialog title={selected === 'LP' ? `OKB / sFAB · ${m.lpPositions}` : `${selected} · ${m.details}`} onClose={() => setSelected(undefined)}>
      <dl className="fragment-review">
        <dt>{selected === 'LP' ? m.lpAmount : m.balance}</dt><dd>{formatEther(selectedBalance)} {selected === 'LP' ? 'sLP' : selected}</dd>
        {selected === 'LP' && <><dt>{m.principalAmounts}</dt><dd>{formatEther(ownedOkb)} OKB<br />{formatEther(ownedShares)} sFAB</dd></>}
        <dt>{m.wallet}</dt><dd><a href={`${NETWORK.explorerUrl}/address/${account}`} target="_blank" rel="noreferrer">{account}</a></dd>
        <dt>{m.contract}</dt><dd>{address ? <a href={`${NETWORK.explorerUrl}/address/${address}`} target="_blank" rel="noreferrer">{address}</a> : m.nativeAsset}</dd>
      </dl>
      {selected === 'LP' && <p className="fragment-muted">{m.ignixScope}</p>}
    </Dialog>}
  </div>
}
