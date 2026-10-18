import { privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'
import { TEST_RPC, TEST_SIGNER, validateConfig } from '../src/config.ts'
import { address, record, ServiceError, same, type AdmissionSigner, type KeeperSigner, type OperatingPolicy, type RuntimeConfig } from '../src/types.ts'
import type { MiningEnv } from './runtime.ts'
const uint = (v = '0'): bigint => {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(v) || BigInt(v) >= 1n << 256n) throw new ServiceError('invalid_config', 503)
  return BigInt(v)
}
function policy(value: string | undefined): OperatingPolicy | null {
  if (!value || value === 'policy_pending') return null
  let p: unknown
  try { p = JSON.parse(value) } catch { throw new ServiceError('invalid_policy', 503) }
  const keys = ['maxProjects', 'maxProjectsPerWallet', 'allowedListingIds', 'inventorySeller', 'maxProcurementFabRaw', 'maxMinerPriceWei', 'maxConversionInputRaw', 'slippageBps']
  if (!record(p) || Object.keys(p).length !== keys.length || keys.some(k => !(k in (p as Record<string, unknown>))) ||
      typeof p.maxProjects !== 'number' || typeof p.maxProjectsPerWallet !== 'number' || !Array.isArray(p.allowedListingIds) ||
      p.allowedListingIds.some(v => typeof v !== 'string') || !address(p.inventorySeller) || typeof p.slippageBps !== 'number' ||
      typeof p.maxProcurementFabRaw !== 'string' || typeof p.maxMinerPriceWei !== 'string' || typeof p.maxConversionInputRaw !== 'string') throw new ServiceError('invalid_policy', 503)
  return { maxProjects: p.maxProjects, maxProjectsPerWallet: p.maxProjectsPerWallet, allowedListingIds: p.allowedListingIds as string[], inventorySeller: p.inventorySeller,
    maxProcurementFabRaw: uint(p.maxProcurementFabRaw), maxMinerPriceWei: uint(p.maxMinerPriceWei), maxConversionInputRaw: uint(p.maxConversionInputRaw), slippageBps: p.slippageBps }
}
function additionalOrigins(value: string | undefined): string[] {
  if (value === undefined) return []
  let origins: unknown
  try { origins = JSON.parse(value) } catch { throw new ServiceError('invalid_1952_config', 503) }
  if (!Array.isArray(origins) || origins.some(origin => typeof origin !== 'string')) throw new ServiceError('invalid_1952_config', 503)
  return origins as string[]
}
export function cloudConfig(env: MiningEnv): { config: RuntimeConfig; authorizer?: AdmissionSigner; keeper?: KeeperSigner } {
  if ([env.MINING_ADMISSION_ENABLED, env.MINING_EXECUTION_ENABLED].some(v => v !== undefined && v !== 'true' && v !== 'false')) throw new ServiceError('invalid_config', 503)
  const keeperAddress = !env.MINING_KEEPER_ADDRESS ? null : env.MINING_KEEPER_ADDRESS
  if (keeperAddress !== null && !address(keeperAddress)) throw new ServiceError('invalid_keeper', 503)
  const config = validateConfig({ chainId: 1952, rpcUrl: TEST_RPC, publicOrigin: env.MINING_PUBLIC_ORIGIN,
    additionalPublicOrigins: additionalOrigins(env.MINING_ADDITIONAL_PUBLIC_ORIGINS),
    admissionEnabled: env.MINING_ADMISSION_ENABLED === 'true', executionEnabled: env.MINING_EXECUTION_ENABLED === 'true',
    expectedSigner: TEST_SIGNER, keeperAddress, ...(env.MINING_EXPIRED_RECOVERY_HASH === undefined ? {} : { expiredRecoveryHash: env.MINING_EXPIRED_RECOVERY_HASH as Hex }), gasCapWei: uint(env.MINING_GAS_CAP_WEI), maxGasPerTransaction: uint(env.MINING_MAX_GAS_PER_TRANSACTION),
    maxGasPriceWei: uint(env.MINING_MAX_GAS_PRICE_WEI), policy: policy(env.MINING_OPERATING_POLICY), pollMs: env.MINING_POLL_MS ? Number(env.MINING_POLL_MS) : null })
  let authorizer: AdmissionSigner | undefined, keeper: KeeperSigner | undefined
  if (env.MINING_SIGNER_PRIVATE_KEY) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(env.MINING_SIGNER_PRIVATE_KEY)) throw new ServiceError('invalid_authorizer_secret', 503)
    const account = privateKeyToAccount(env.MINING_SIGNER_PRIVATE_KEY as Hex)
    if (!same(account.address, TEST_SIGNER)) throw new ServiceError('authorizer_mismatch', 503)
    authorizer = { address: account.address, signMessage: payload => account.signMessage({ message: { raw: payload } }), signTypedData: value => account.signTypedData(value) }
  }
  if (env.MINING_KEEPER_PRIVATE_KEY) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(env.MINING_KEEPER_PRIVATE_KEY)) throw new ServiceError('invalid_keeper_secret', 503)
    const account = privateKeyToAccount(env.MINING_KEEPER_PRIVATE_KEY as Hex)
    if (!config.keeperAddress || !same(account.address, config.keeperAddress) || same(account.address, TEST_SIGNER)) throw new ServiceError('keeper_mismatch', 503)
    keeper = { address: account.address, signTransaction: plan => account.signTransaction(plan) }
  }
  if (config.admissionEnabled && !authorizer || config.executionEnabled && (!authorizer || !keeper)) throw new ServiceError('signer_not_configured', 503)
  return { config, authorizer, keeper }
}
