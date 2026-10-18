import type { Address } from 'viem'
import { address, ServiceError, type RuntimeConfig } from './types.ts'
export const TEST_SIGNER = '0x5DeAca6ecc97b07cA95D700f2BB26e4466774Ab6' as Address
export const APPROVED_EXPIRED_RECOVERY_HASH = '0x0fb7c2a1a0a532e8531744e408a31422b2e0c43a93ed8847e7eec3a46707c3a5'
export const TEST_RPC = 'https://testrpc.xlayer.tech/terigon'
export function validateConfig(c: RuntimeConfig, local = false): RuntimeConfig {
  const origin = new URL(c.publicOrigin), rpc = new URL(c.rpcUrl)
  const ownedLoopback = local && rpc.protocol === 'http:' && rpc.hostname === '127.0.0.1' && rpc.pathname === '/' &&
    origin.protocol === 'http:' && origin.hostname === '127.0.0.1'
  if (c.chainId !== 1952 || !address(c.expectedSigner) || !ownedLoopback && c.expectedSigner.toLowerCase() !== TEST_SIGNER.toLowerCase() ||
      origin.origin !== c.publicOrigin || origin.username || origin.password ||
      !(origin.protocol === 'https:' || local && origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname)) ||
      !(c.rpcUrl === TEST_RPC || local && rpc.protocol === 'http:' && rpc.hostname === '127.0.0.1' && rpc.pathname === '/')) throw new ServiceError('invalid_1952_config', 503)
  if (c.expiredRecoveryHash !== undefined && c.expiredRecoveryHash !== APPROVED_EXPIRED_RECOVERY_HASH) throw new ServiceError('invalid_recovery_policy', 503)
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
