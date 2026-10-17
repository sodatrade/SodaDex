import type { OrderAddress } from './order-types'
export interface OrderDeployment { chainId: 196; settlement: OrderAddress; deploymentBlock: number; apiOrigin: string; executionEnabled: true }
/** The browser and RPC boundary enable the same reviewed test deployment. */
export function orderDeployment(value: unknown): OrderDeployment | undefined {
  if (!value || typeof value !== 'object') return
  const v = value as Record<string, unknown>
  if (v.schemaVersion !== 1 || v.chainId !== 196 || v.stage !== 'test' || v.status !== 'ready' || v.executionEnabled !== true ||
    typeof v.settlement !== 'string' || !/^0x[\da-f]{40}$/i.test(v.settlement) || /^0x0{40}$/i.test(v.settlement) ||
    typeof v.deploymentBlock !== 'number' || !Number.isSafeInteger(v.deploymentBlock) || v.deploymentBlock < 0 || typeof v.apiOrigin !== 'string') return
  try {
    const url = new URL(v.apiOrigin)
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) return
    return { chainId: 196, settlement: v.settlement as OrderAddress, deploymentBlock: v.deploymentBlock, apiOrigin: url.origin, executionEnabled: true }
  } catch { return }
}
