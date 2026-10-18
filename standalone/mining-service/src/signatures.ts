import { encodeAbiParameters, hashTypedData, keccak256, parseAbiParameters, type Address, type Hex } from 'viem'
import { MINING_CREATE_PARAMS_ABI } from '../../mining-abi.ts'
import { MINING_LAUNCH_TEST_POLICY, miningLaunchVaultData, type MiningCreateParams, type MiningPurchase, type MiningConversion } from '../../mining-signed-calls.ts'
import type { MiningProductDeployment } from '../../mining-products.ts'
import type { TypedAuthorization } from './types.ts'
export function launchPayload(d: MiningProductDeployment, caller: Address, p: MiningCreateParams, expiresAt: number, poolFee: number, launchFactory: Address): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters(`uint256,address,address,${MINING_CREATE_PARAMS_ABI},uint16,bytes,uint64,address,uint8,uint64,uint24,address`),
    [BigInt(d.chainId), d.contracts.manager.address, caller, p, d.templateId, miningLaunchVaultData(), BigInt(expiresAt),
      d.contracts.miningFactory.address, MINING_LAUNCH_TEST_POLICY.venue, MINING_LAUNCH_TEST_POLICY.graduationProtectionSecs, poolFee, launchFactory]))
}
export function purchaseTyped(farm: Address, p: MiningPurchase, chainId: 1952 | 196 = 1952): TypedAuthorization {
  return { domain: { name: 'SodaDEX TEST FAB Mining Farm', version: '1', chainId, verifyingContract: farm }, primaryType: 'Purchase',
    types: { Purchase: ['listingId', 'minerId', 'nativePrice', 'maxFab', 'nonce', 'deadline'].map(name => ({ name, type: 'uint256' })) }, message: { ...p } }
}
export function conversionTyped(vault: Address, p: MiningConversion, chainId: 1952 | 196 = 1952): TypedAuthorization {
  return { domain: { name: 'SodaDEX TEST Mining Tax Vault', version: '1', chainId, verifyingContract: vault }, primaryType: 'Conversion',
    types: { Conversion: ['input', 'minimumFab', 'nonce', 'deadline'].map(name => ({ name, type: 'uint256' })) }, message: { ...p } }
}
export const authorizationDigest = (typed: TypedAuthorization): Hex => hashTypedData(typed)
