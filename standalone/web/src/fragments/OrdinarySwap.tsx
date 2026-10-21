import { useQuery } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { getBalances } from '../lib/rpc'
import type { WalletController } from '../lib/useWallet'
import { NETWORK } from '../network'
import { TradeWorkspace } from '../features/trade/TradeWorkspace'
import '../workspace.css'
export function OrdinarySwap({ wallet, active, onConnect, onCreatePool, onBusyChange }: {
  wallet: WalletController; active: boolean; onConnect: () => void; onCreatePool: () => void; onBusyChange: (busy: boolean) => void
}): ReactElement {
  const address = wallet.session?.chainId === NETWORK.chainId ? wallet.session.address : undefined
  const balances = useQuery({ queryKey: ['balances', NETWORK.chainId, address], enabled: !!address,
    queryFn: () => getBalances(address ?? ''), retry: false, refetchInterval: 20000 })
  return <TradeWorkspace wallet={wallet} active={active} balances={address ? balances.data : undefined}
    balancesLoading={balances.isFetching} balancesError={balances.isError} onConnect={onConnect}
    onCreatePool={onCreatePool} onBusyChange={onBusyChange} />
}
