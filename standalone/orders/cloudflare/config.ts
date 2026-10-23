import deployment from '../../../deployments/orders-test.json' with { type: 'json' }
import { privateKeyToAccount } from 'viem/accounts'
import type { Address, Hex } from 'viem'
import { FIXED, validateRuntime, type OrderRuntimeConfig } from '../src/config.ts'
import type { ExecutionSigner } from '../src/chain-types.ts'
import type { OrdersEnv } from './runtime.ts'
export const actorName = (): string => `sodadex-orders:196:${deployment.settlement === null ? 'undeployed' : String(deployment.settlement).toLowerCase()}`
export function cloudConfig(env: OrdersEnv): { config: OrderRuntimeConfig; signer: ExecutionSigner | undefined; pollMs: number | null } {
  if (deployment.schemaVersion !== 1 || deployment.chainId !== 196 || deployment.stage !== 'test') throw Error('Reviewed test deployment required')
  const pollMs = env.ORDERS_POLL_MS && /^[1-9][0-9]*$/.test(env.ORDERS_POLL_MS) ? Number(env.ORDERS_POLL_MS) : null
  if (pollMs !== null && (!Number.isSafeInteger(pollMs) || pollMs < 1000)) throw Error('Invalid explicit alarm interval')
  const budget = env.ORDERS_GAS_BUDGET_WEI ?? '0'
  if (!/^(0|[1-9][0-9]*)$/.test(budget) || budget.length > 78) throw Error('Invalid explicit gas budget')
  let signer: ExecutionSigner | undefined
  const key = env.ORDERS_KEEPER_PRIVATE_KEY, expected = env.ORDERS_KEEPER_ADDRESS
  if (key) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(key) || !expected || !/^0x[0-9a-fA-F]{40}$/.test(expected)) throw Error('Dedicated keeper configuration required')
    const account = privateKeyToAccount(key as Hex)
    if (account.address.toLowerCase() !== expected.toLowerCase()) throw Error('Dedicated keeper address mismatch')
    signer = { address: account.address, signTransaction: plan => account.signTransaction({ ...plan, type: 'legacy' }) }
  }
  const executionEnabled = deployment.status === 'ready' && deployment.executionEnabled && env.ORDERS_EXECUTION_ENABLED === 'true' && !!signer && pollMs !== null && BigInt(budget) > 0n
  const additional: unknown = env.ORDERS_ADDITIONAL_PUBLIC_ORIGINS === undefined ? [] : JSON.parse(env.ORDERS_ADDITIONAL_PUBLIC_ORIGINS)
  if (!Array.isArray(additional) || additional.some(value => typeof value !== 'string')) throw Error('Invalid additional orders origins')
  const config = validateRuntime({ settlement: deployment.settlement as Address | null, rpcUrl: FIXED.rpcUrl, publicOrigin: env.ORDERS_PUBLIC_ORIGIN ?? '', additionalPublicOrigins: additional, executionEnabled, gasBudgetWei: BigInt(budget) })
  return { config, signer, pollMs }
}
