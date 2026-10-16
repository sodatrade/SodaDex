import { decodeFunctionData, encodeFunctionData, type Abi, type Hex } from 'viem'
import { deployment, ERC20_READ, FACTORY_READ, same, STATE_READ, V3_POOL_READ, V3_POSITION_READ, V4_POSITION_READ } from './contracts'

function canonical(abi: Abi, data: Hex): boolean {
  try {
    const decoded = decodeFunctionData({ abi, data })
    return same(encodeFunctionData({ abi, functionName: decoded.functionName, args: decoded.args }), data)
  } catch { return false }
}
export function contractReadKind(to: string, data: Hex): 'read' | 'pool' | null {
  // ERC20 metadata/balance reads are address-independent; no write selectors are admitted.
  if (canonical(ERC20_READ, data)) return 'read'
  if (same(to, deployment.contracts.v3Factory) && canonical(FACTORY_READ, data)) return 'read'
  if (same(to, deployment.contracts.v3PositionManager) && canonical(V3_POSITION_READ, data)) return 'read'
  if (same(to, deployment.contracts.v4PositionManager) && canonical(V4_POSITION_READ, data)) return 'read'
  if (same(to, deployment.contracts.v4StateView) && canonical(STATE_READ, data)) return 'read'
  return canonical(V3_POOL_READ, data) ? 'pool' : null
}
