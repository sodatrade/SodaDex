import type { Address } from 'viem'
import { address, ServiceError, type RuntimeConfig } from './types.ts'
export const TEST_SIGNER = '0x5DeAca6ecc97b07cA95D700f2BB26e4466774Ab6' as Address
export const APPROVED_EXPIRED_RECOVERY_HASH = '0x0fb7c2a1a0a532e8531744e408a31422b2e0c43a93ed8847e7eec3a46707c3a5'
const TEST_1952_KEEPER = '0x553d8c2e637fe67c5c7ade3810e8bc02799d41d4'
export const TEST_RPC = 'https://testrpc.xlayer.tech/terigon'
export function frontendOriginAllowed(c: RuntimeConfig, origin: string | null): origin is string {
  return origin !== null && (origin === c.publicOrigin || (c.additionalPublicOrigins ?? []).includes(origin))
}
function validFrontendOrigin(value: unknown, local: boolean): value is string {
  if (typeof value !== 'string') return false
  try {
    const origin = new URL(value)
    return origin.origin === value && !origin.username && !origin.password &&
      (origin.protocol === 'https:' || local && origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname))
  } catch { return false }
}
export function validateConfig(c: RuntimeConfig, local = false): RuntimeConfig {
  const additional = c.additionalPublicOrigins ?? []
  if (!validFrontendOrigin(c.publicOrigin, local) || !Array.isArray(additional) ||
      additional.some(origin => !validFrontendOrigin(origin, local) || origin === c.publicOrigin) ||
      new Set(additional).size !== additional.length) throw new ServiceError('invalid_1952_config', 503)
  const origin = new URL(c.publicOrigin), rpc = new URL(c.rpcUrl)
  const ownedLoopback = local && rpc.protocol === 'http:' && rpc.hostname === '127.0.0.1' && rpc.pathname === '/' &&
    origin.protocol === 'http:' && origin.hostname === '127.0.0.1'
  const isolated196 = c.profileId === '196-mining-test' && c.chainId === 196
  const legacy1952 = c.chainId === 1952 && (!c.profileId || c.profileId === '1952-mining-test')
  if ((!isolated196 && !legacy1952) || !address(c.expectedSigner) ||
      legacy1952 && !ownedLoopback && c.expectedSigner.toLowerCase() !== TEST_SIGNER.toLowerCase() ||
      isolated196 && c.expectedSigner.toLowerCase() === TEST_SIGNER.toLowerCase() ||
      !(c.rpcUrl === (isolated196 ? 'https://rpc.ignix.bot/rpc/196' : TEST_RPC) || ownedLoopback)) throw new ServiceError('invalid_1952_config', 503)
  if (c.expiredRecoveryHash !== undefined && (isolated196 || c.expiredRecoveryHash !== APPROVED_EXPIRED_RECOVERY_HASH)) throw new ServiceError('invalid_recovery_policy', 503)
  if (isolated196 && c.keeperAddress?.toLowerCase() === TEST_1952_KEEPER) throw new ServiceError('separate_keeper_required', 503)
  if (c.keeperAddress !== null && (!address(c.keeperAddress) || c.keeperAddress.toLowerCase() === c.expectedSigner.toLowerCase())) throw new ServiceError('invalid_keeper', 503)
  if ([c.gasCapWei, c.maxGasPerTransaction, c.maxGasPriceWei].some(v => v < 0n)) throw new ServiceError('invalid_budget', 503)
  if (c.pollMs !== null && (!Number.isSafeInteger(c.pollMs) || c.pollMs < 1000)) throw new ServiceError('invalid_poll', 503)
  if (c.admissionEnabled || c.executionEnabled) {
    const p = c.policy
    if (!p || !Number.isSafeInteger(p.maxProjects) || p.maxProjects < 1 || !Number.isSafeInteger(p.maxProjectsPerWallet) ||
        p.maxProjectsPerWallet < 1 || p.maxProjectsPerWallet > p.maxProjects || !address(p.inventorySeller) ||
        !Number.isSafeInteger(p.slippageBps) || p.slippageBps < 0 || p.slippageBps >= 10000 ||
        p.allowedListingIds.some(v => !/^(0|[1-9][0-9]{0,77})$/.test(v) || BigInt(v) >= 1n << 256n) ||
        new Set(p.allowedListingIds).size !== p.allowedListingIds.length ||
        p.maxProcurementFabRaw <= 0n || p.maxMinerPriceWei <= 0n || p.maxConversionInputRaw <= 0n) throw new ServiceError('policy_pending', 503)
  }
  if (c.executionEnabled && (!c.keeperAddress || c.gasCapWei <= 0n || c.maxGasPerTransaction <= 0n || c.maxGasPriceWei <= 0n || c.pollMs === null)) throw new ServiceError('execution_policy_pending', 503)
  return c
}
