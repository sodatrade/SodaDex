import { useQuery } from '@tanstack/react-query'
import type { ReactElement, ReactNode } from 'react'
import { getBalances } from '../lib/rpc'
import type { WalletController } from '../lib/useWallet'
import { NETWORK } from '../network'
import { TradeWorkspace } from '../features/trade/TradeWorkspace'
import '../workspace.css'
import { shareSymbol, shareToken, type FragmentDeployment } from './config'
import type { ScreenProps } from './types'
import { SwapScreen } from './SwapScreen'
import { MarketPanel } from './MarketPanel'
import type { Currency } from '../liquidity/types'
import { messages } from './messages'
import { usePreferences } from '../preferences/context'
import { Button } from '../components/primitives'
import { NATIVE_CURRENCY } from '../liquidity/config'
export function OrdinarySwap({ wallet, active, onConnect, onCreatePool, onBusyChange, fragment }: {
  wallet: WalletController; active: boolean; onConnect: () => void; onCreatePool: () => void; onBusyChange: (busy: boolean) => void
  fragment?: { deployment: FragmentDeployment; screen?: ScreenProps; fallback: ReactNode }
}): ReactElement {
  const { locale } = usePreferences(), m = messages(locale)
  const address = wallet.session?.chainId === NETWORK.chainId ? wallet.session.address : undefined
  const balances = useQuery({ queryKey: ['balances', NETWORK.chainId, address], enabled: !!address,
    queryFn: () => getBalances(address ?? ''), retry: false, refetchInterval: 20000 })
  const share: Currency | undefined = fragment ? { address: shareToken(fragment.deployment), symbol: shareSymbol(fragment.deployment), name: 'Soda miner shares', decimals: 18, native: false } : undefined
  const matches = (from: Currency, to: Currency): boolean => !!share && ((from.native && !to.native && to.address.toLowerCase() === share.address.toLowerCase()) || (to.native && !from.native && from.address.toLowerCase() === share.address.toLowerCase()))
  return <TradeWorkspace wallet={wallet} active={active} balances={address ? balances.data : undefined}
    balancesLoading={balances.isFetching} balancesError={balances.isError} onConnect={onConnect}
    pairExtension={share && fragment ? { currencies: [NATIVE_CURRENCY, share], matches, render: selection => fragment.screen ? <fieldset className="fragment-workspace" disabled={fragment.screen.busy}><SwapScreen {...fragment.screen} selection={selection} onConnect={onConnect} onAddLiquidity={onCreatePool} /></fieldset> : <section className="fragment-card"><h2>{m.swap}</h2><div className="fragment-actions"><Button onClick={() => selection.onSelect('from')}>{selection.from.symbol} ▾</Button><Button onClick={() => selection.onSelect('to')}>{selection.to.symbol} ▾</Button></div>{fragment.fallback}</section> } : undefined}
    renderMarket={context => context && fragment && matches(context.from, context.to) ? <MarketPanel deployment={fragment.deployment} m={m} /> : undefined}
    onCreatePool={onCreatePool} onBusyChange={onBusyChange} />
}
