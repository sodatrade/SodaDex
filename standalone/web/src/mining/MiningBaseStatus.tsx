import { useQuery } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { formatUnits } from 'viem'
import { MINING_BASE } from '../../../mining-contracts'
import { Button, Surface } from '../components/primitives'
import { miningNetworkMessages } from '../i18n/mining-network'
import { shortenAddress } from '../lib/address'
import { NETWORK } from '../network'
import { usePreferences } from '../preferences/context'
import { miningAccount, miningOverview } from './reads'

export function MiningBaseStatus({ block, account }: { block?: bigint; account?: `0x${string}` }): ReactElement {
  const { locale } = usePreferences(), m = miningNetworkMessages(locale)
  const overview = useQuery({ queryKey: ['mining-overview', NETWORK.id, block?.toString()], enabled: block !== undefined,
    queryFn: () => miningOverview(block!), retry: false })
  const wallet = useQuery({ queryKey: ['mining-account', NETWORK.id, block?.toString(), account], enabled: block !== undefined && !!account,
    queryFn: () => miningAccount(block!, account!), retry: false })
  return <Surface className="mining-network-status" aria-labelledby="mining-base-title">
    <h2 id="mining-base-title">{m.baseTitle}</h2><p>{m.baseDetail}</p>
    <dl className="review-details">
      <div><dt>{m.registeredMiners}</dt><dd>{overview.data?.minerCount.toString() ?? '—'}</dd></div>
      <div><dt>{m.verifiedMiners}</dt><dd>{overview.data?.verifiedCount.toString() ?? '—'}</dd></div>
      <div><dt>{m.totalMined}</dt><dd>{overview.data ? `${formatUnits(overview.data.totalMined, 8)} TEST-FAB` : '—'}</dd></div>
      <div><dt>{m.fabBalance}</dt><dd>{account && wallet.data ? `${formatUnits(wallet.data.fab, 8)} TEST-FAB` : '—'}</dd></div>
      <div><dt>{m.nftBalance}</dt><dd>{account ? wallet.data?.miners.toString() ?? '—' : '—'}</dd></div>
    </dl>
    {(overview.isError || wallet.isError) && <p role="alert">{m.baseUnavailable}</p>}
    {(overview.isError || wallet.isError) && <Button disabled={overview.isFetching || wallet.isFetching} onClick={() => {
      void overview.refetch(); if (account) void wallet.refetch()
    }}>{m.reload}</Button>}
    <p className="dialog-note">{m.actualOutput}</p>
    <details><summary>{m.baseAddresses}</summary><dl className="review-details mining-contract-addresses">
      {(['fab', 'mining', 'circuits', 'circuitMarket', 'lens'] as const).map((role) => <div key={role}>
        <dt>{m[role]}</dt><dd><a href={`${NETWORK.explorerUrl}/address/${MINING_BASE[role]}`} target="_blank" rel="noreferrer" title={MINING_BASE[role]}>{shortenAddress(MINING_BASE[role])}</a></dd>
      </div>)}
    </dl></details>
  </Surface>
}
