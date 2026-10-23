import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { getAddress, type Address } from 'viem'
import { readImportedTokenAddresses, TOKEN_CATALOG_CHANGED } from '../../domain/tokenCatalog'
import { KNOWN_CURRENCIES } from '../../liquidity/config'
import { importCurrency } from '../../liquidity/currencies'
import type { Currency } from '../../liquidity/types'
import { getReferenceTokens } from './referenceApi'
export interface CatalogToken { currency: Currency; source: 'builtin' | 'officialList' | 'imported' }
export const builtinTokens: CatalogToken[] = KNOWN_CURRENCIES.map(currency => ({ currency, source: 'builtin' }))
export function mergeCatalog(entries: CatalogToken[]): CatalogToken[] {
  const tokens = new Map<string, CatalogToken>()
  for (const entry of entries) if (!tokens.has(entry.currency.address.toLowerCase())) tokens.set(entry.currency.address.toLowerCase(), entry)
  return [...tokens.values()]
}
export async function getExploreCatalog(addresses: Address[]): Promise<{ tokens: CatalogToken[]; partial: boolean }> {
  const [official, imported] = await Promise.all([
    getReferenceTokens().catch(() => undefined),
    Promise.allSettled(addresses.map(address => importCurrency(address))),
  ])
  const curated = official?.flatMap((t): CatalogToken[] => t.symbol !== null && t.name !== null && t.decimals !== null
    ? [{ currency: { address: getAddress(t.address), symbol: t.symbol, name: t.name, decimals: t.decimals, native: false }, source: 'officialList' }] : []) ?? []
  return { tokens: mergeCatalog([...builtinTokens, ...curated, ...imported.flatMap((r): CatalogToken[] =>
    r.status === 'fulfilled' ? [{ currency: r.value, source: 'imported' }] : [])]),
  partial: official === undefined || curated.length !== official.length || imported.some(r => r.status === 'rejected') }
}
/** Shared catalog reads plus local-storage subscriptions, with partial failures kept visible. */
export function useExploreCatalog() {
  const [addresses, setAddresses] = useState(readImportedTokenAddresses)
  useEffect(() => {
    const changed = (): void => setAddresses(readImportedTokenAddresses())
    window.addEventListener(TOKEN_CATALOG_CHANGED, changed); window.addEventListener('storage', changed)
    return () => { window.removeEventListener(TOKEN_CATALOG_CHANGED, changed); window.removeEventListener('storage', changed) }
  }, [])
  return useQuery({ queryKey: ['explore-catalog', addresses.join(',')], queryFn: () => getExploreCatalog(addresses), retry: false, staleTime: 60_000 })
}
