import { encodeAbiParameters, keccak256, zeroAddress, type Address } from 'viem'
import plan from '../../../../deployments/xlayer-test/active.json'
import { CHAIN_ID, STABLE_ADDRESS, WOKB_ADDRESS } from '../domain/assets'

export const CONTRACTS = {
  router: plan.contracts.universalRouter as Address,
  permit2: plan.permit2 as Address,
  v3Quoter: plan.contracts.v3Quoter as Address,
  v4Quoter: plan.contracts.v4Quoter as Address,
} as const
export const SLIPPAGE_BPS = 50n
export const DEADLINE_SECONDS = 600n
export const POOL_KEY = {
  currency0: zeroAddress,
  currency1: STABLE_ADDRESS,
  fee: 0,
  tickSpacing: 1,
  hooks: zeroAddress,
} as const
export const POOL_KEY_TYPE = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
} as const
export const V4_POOL_ID = keccak256(encodeAbiParameters([POOL_KEY_TYPE], [POOL_KEY]))
export interface PoolManifest {
  ready: boolean
  v3Address?: Address
}
const same = (a: unknown, b: string): boolean => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()

/** A missing, pending, or inconsistent deployment record never enables wallet transactions. */
export function validatePools(value: unknown): PoolManifest {
  if (!value || typeof value !== 'object') return { ready: false }
  const m = value as Record<string, unknown>
  const stable = m.stable as Record<string, unknown> | undefined
  const v3 = m.v3 as Record<string, unknown> | undefined
  const v4 = m.v4 as Record<string, unknown> | undefined
  if (
    m.schemaVersion !== 1 ||
    m.chainId !== CHAIN_ID ||
    m.status !== 'ready' ||
    m.slippageBps !== Number(SLIPPAGE_BPS) ||
    m.deadlineSeconds !== Number(DEADLINE_SECONDS) ||
    !same(stable?.address, STABLE_ADDRESS) ||
    stable?.decimals !== 6 ||
    !v3 ||
    !v4 ||
    !same(v3.token0, STABLE_ADDRESS) ||
    !same(v3.token1, WOKB_ADDRESS) ||
    v3.fee !== 100 ||
    v3.tickSpacing !== 1 ||
    typeof v3.address !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(v3.address) ||
    same(v3.address, zeroAddress) ||
    !same(v4.poolId, V4_POOL_ID) ||
    !same(v4.currency0, zeroAddress) ||
    !same(v4.currency1, STABLE_ADDRESS) ||
    v4.fee !== 0 ||
    v4.tickSpacing !== 1 ||
    !same(v4.hooks, zeroAddress)
  )
    return { ready: false }
  return { ready: true, v3Address: v3.address as Address }
}
const manifests = import.meta.glob('../../../../deployments/xlayer-test/pools.json', { eager: true, import: 'default' })
export const POOLS = validatePools(Object.values(manifests)[0])
