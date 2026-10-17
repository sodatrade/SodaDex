import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { MiningAddress, MiningProductDeployment } from '../../../mining-products'
import { loadOnlineCatalog, parseOnlineCatalog, type MiningLaunchRegistration, type MiningOnlineCatalog } from './onlineApi'

/** Catalog revisions refresh runtime/balance reads without changing the deployment journal identity. */
export function useOnlineCatalog(base: MiningProductDeployment, selectedToken?: MiningAddress): {
  deployment: MiningProductDeployment; revision: string; unavailable: boolean
  accept: (registered: MiningLaunchRegistration) => void
} {
  const client = useQueryClient(), key = ['mining-online-catalog', base.version] as const
  const queryKey = [...key, selectedToken]
  const result = useQuery({ queryKey, queryFn: async () => {
    const incoming = await loadOnlineCatalog(base, selectedToken), previous = client.getQueryData<MiningOnlineCatalog>(queryKey)
    return parseOnlineCatalog(previous?.deployment ?? base, incoming.deployment.projects, incoming.revision)
  },
    retry: false, refetchInterval: 15_000, staleTime: 5000, placeholderData: (previous) => previous })
  return {
    deployment: result.data?.deployment ?? base, revision: result.data?.revision ?? base.version, unavailable: result.isError,
    accept: (registered) => {
      const merge = (previous: MiningOnlineCatalog | undefined): MiningOnlineCatalog =>
        parseOnlineCatalog(previous?.deployment ?? base, [registered.project], registered.revision)
      client.setQueriesData<MiningOnlineCatalog>({ queryKey: key }, merge)
      client.setQueryData<MiningOnlineCatalog>([...key, registered.project.token.address], merge(result.data))
      void client.invalidateQueries({ queryKey: key })
    },
  }
}
