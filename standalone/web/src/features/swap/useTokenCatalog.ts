import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { readImportedTokenAddresses, TOKEN_CATALOG_CHANGED } from '../../domain/tokenCatalog'
import { importCurrency } from '../../liquidity'
import type { Currency } from '../../liquidity/types'
export function useTokenCatalog(): Currency[] {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const changed = (): void => setRevision((v) => v + 1)
    window.addEventListener(TOKEN_CATALOG_CHANGED, changed); window.addEventListener('storage', changed)
    return () => { window.removeEventListener(TOKEN_CATALOG_CHANGED, changed); window.removeEventListener('storage', changed) }
  }, [])
  const query = useQuery({ queryKey: ['token-catalog', revision], queryFn: async () => {
    const checked = await Promise.allSettled(readImportedTokenAddresses().map((address) => importCurrency(address)))
    return checked.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  }, retry: false })
  return query.data ?? []
}
