import { useQuery } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { decodeFunctionResult, encodeFunctionData, formatUnits, zeroAddress, type Address, type Hex } from 'viem'
import { Button, Icon, Surface } from '../../components/primitives'
import { CHAIN_ID, EXPLORER_URL } from '../../domain/assets'
import { exploreMessages } from '../../i18n/explore'
import { tokenAbi } from '../../liquidity/abis'
import { importCurrency } from '../../liquidity/currencies'
import { listPools } from '../../liquidity/pools'
import type { LiquidityPool } from '../../liquidity/types'
import { hexQuantity, rpc } from '../../lib/rpc'
import type { WalletController } from '../../lib/useWallet'
import { usePreferences } from '../../preferences/context'
import { PoolQuotePanel } from '../liquidity/PoolQuotePanel'
import { TokenIcon } from '../../components/TokenIcon'
export function TokenDetail({ address, wallet, onConnect, onBack }: {
  address: Address; wallet: WalletController; onConnect: () => void; onBack: () => void
}): ReactElement {
  const { locale } = usePreferences(), m = exploreMessages(locale), [selected, setSelected] = useState<LiquidityPool>()
  const token = useQuery({ queryKey: ['explore-token', address], queryFn: () => importCurrency(address), retry: false })
  const account = wallet.session?.chainId === CHAIN_ID ? wallet.session.address : undefined
  const currency = token.data
  const balance = useQuery({ queryKey: ['explore-balance', address, account], enabled: !!account && !!currency, retry: false,
    queryFn: async () => currency!.native ? hexQuantity(await rpc('eth_getBalance', [account, 'latest'])) :
      decodeFunctionResult({ abi: tokenAbi, functionName: 'balanceOf', data: await rpc('eth_call', [{ to: currency!.address,
        data: encodeFunctionData({ abi: tokenAbi, functionName: 'balanceOf', args: [account!] }) }, 'latest']) as Hex }) as bigint })
  const pools = useQuery({ queryKey: ['liquidity', 'pools'], queryFn: () => listPools(), retry: false, staleTime: 30_000 })
  const matching = pools.data?.filter(p => [p.currency0, p.currency1].some(c => c.address.toLowerCase() === address.toLowerCase() || (address === zeroAddress && c.native))) ?? []
  return <div className="explore-detail">
    <Button appearance="ghost" onClick={onBack}>← {m.back}</Button>
    {token.isPending && <p role="status">{m.loading}</p>}
    {token.isError && <p role="alert" className="error-text">{m.error} <Button onClick={() => void token.refetch()}>{m.retry}</Button></p>}
    {currency && <Surface className="explore-token-detail"><header><TokenIcon address={currency.address} symbol={currency.symbol} native={currency.native} /><div><h2>{currency.symbol}</h2><p>{currency.name}</p></div></header>
      <dl className="explore-facts"><dt>{m.network}</dt><dd>X Layer · 196</dd><dt>{m.decimals}</dt><dd>{currency.decimals}</dd><dt>{m.contract}</dt>
        <dd>{currency.native ? m.native : <a href={`${EXPLORER_URL}/address/${address}`} target="_blank" rel="noreferrer">{address} <Icon name="external" size={14} /></a>}</dd>
        <dt>{m.balance}</dt><dd>{account ? balance.isError ? <span role="alert">{m.error} <Button appearance="ghost" onClick={() => void balance.refetch()}>{m.retry}</Button></span>
          : balance.data !== undefined ? `${formatUnits(balance.data, currency.decimals)} ${currency.symbol}` : <span role="status">{m.loading}</span>
          : <Button onClick={wallet.session ? () => void wallet.switchChain() : onConnect}>{wallet.session ? m.wrongChain : m.connect}</Button>}</dd></dl>
      <p className="explore-note">{m.metadataNote} {m.noFiat}</p></Surface>}
    <section className="explore-own-pools"><h2>{m.ownPools}</h2><p className="explore-note">{m.readOnly}</p>
      {pools.isPending && <p role="status">{m.loading}</p>}
      {pools.isError && <p role="alert" className="error-text">{m.error} <Button onClick={() => void pools.refetch()}>{m.retry}</Button></p>}
      {pools.isSuccess && !matching.length && <p>{m.noOwnPools}</p>}
      {matching.map(p => <button className="explore-own-pool" key={`${p.protocol}:${p.id}`} aria-pressed={selected?.id === p.id} onClick={() => setSelected(p)}>
        <span>{p.currency0.symbol} / {p.currency1.symbol}</span><span>{p.protocol.toUpperCase()} · {p.fee / 10000}%</span><span>{m.quote} →</span></button>)}
      {selected && <PoolQuotePanel pool={selected} />}
    </section>
  </div>
}
