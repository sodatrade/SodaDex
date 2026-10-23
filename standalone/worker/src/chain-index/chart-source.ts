import { BadRequest } from '../dex-data'
import { RestartScan } from '../cursors'
import { FIRST_BLOCK } from '../contracts'
import type { ChartSourceReader, IndexedChartSource } from '../dex-chart'
import { actorName, baseConfig } from './config'
import type { IndexEnv } from './types'
/** Read the existing durable snapshot; never start a browser-owned historical scan. */
export function indexedChartSource(env: IndexEnv): ChartSourceReader | undefined {
  const binding = env.CHAIN_INDEX
  if (!binding) return undefined
  return async (url) => {
    const actor = binding.get(binding.idFromName(actorName(baseConfig('196-test', env))))
    const response = await actor.fetch(new Request(`https://index.internal/196-test/chart-source${url.search}`))
    if (response.status === 409) throw new RestartScan('CHAIN_REORGANIZED', FIRST_BLOCK)
    if (response.status === 400) { const body = await response.json() as { error?: string }; throw new BadRequest(body.error ?? 'Invalid chart range or pool') }
    if (!response.ok) throw Error('Chart index unavailable')
    return await response.json() as IndexedChartSource
  }
}
