import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { decodeFunctionResult, encodeFunctionData, type Address, type Hex } from 'viem'
import { readImportedTokenAddresses, TOKEN_CATALOG_CHANGED } from '../../domain/tokenCatalog'
import { KNOWN_CURRENCIES } from '../../liquidity/config'
import { importCurrency } from '../../liquidity/currencies'
import { tokenAbi } from '../../liquidity/abis'
import type { Currency } from '../../liquidity/types'
import { hexQuantity, rpc } from '../../lib/rpc'
export interface PortfolioToken { currency: Currency; balance?: bigint }
export function usePortfolioTokens(account?: Address) {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const refresh = (): void => setRevision(v => v + 1)
    window.addEventListener(TOKEN_CATALOG_CHANGED, refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener(TOKEN_CATALOG_CHANGED, refresh); window.removeEventListener('storage', refresh) }
  }, [])
  return useQuery({ queryKey: ['portfolio-tokens', account, revision], enabled: !!account, retry: false, refetchInterval: 30_000,
    queryFn: async () => {
      const imported = await Promise.allSettled(readImportedTokenAddresses().map(a => importCurrency(a)))
      const currencies = new Map(KNOWN_CURRENCIES.map(c => [c.address.toLowerCase(), c]))
      for (const entry of imported) if (entry.status === 'fulfilled') currencies.set(entry.value.address.toLowerCase(), entry.value)
      const tokens = await Promise.all([...currencies.values()].map(async (currency): Promise<PortfolioToken> => {
        try {
          const balance = currency.native ? hexQuantity(await rpc('eth_getBalance', [account, 'latest']))
            : decodeFunctionResult({ abi: tokenAbi, functionName: 'balanceOf', data: await rpc('eth_call', [{ to: currency.address,
              data: encodeFunctionData({ abi: tokenAbi, functionName: 'balanceOf', args: [account!] }) }, 'latest']) as Hex }) as bigint
          return { currency, balance }
        } catch { return { currency } }
      }))
      return { tokens, metadataFailures: imported.filter(e => e.status === 'rejected').length }
    } })
}
