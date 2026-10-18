import type { Address, Hex, TransactionSerializableLegacy } from 'viem'
import type { MiningProductDeployment, MiningProject } from '../../mining-products.ts'
import type { MiningLaunchForm } from '../../mining-signed-calls.ts'
import type { MiningTransaction } from '../../mining-calls.ts'
export interface Rpc { request(method: string, params?: unknown[]): Promise<unknown> }
export interface Block { number: Hex; hash: Hex; timestamp: bigint }
export interface Discovery {
  verifyBase(rpc: Rpc, d: MiningProductDeployment, expectedSigner: Address, block?: string): Promise<Block>
  resolveProject(rpc: Rpc, d: MiningProductDeployment, token: Address, expectedSigner: Address, verifiedBase: Block): Promise<MiningProject>
}
export interface AdmissionSigner {
  address: Address
  signMessage(payload: Hex): Promise<Hex>
  signTypedData(value: TypedAuthorization): Promise<Hex>
}
export interface TypedAuthorization {
  domain: { name: string; version: '1'; chainId: 1952; verifyingContract: Address }
  primaryType: 'Purchase' | 'Conversion'
  types: Record<string, readonly { name: string; type: string }[]>
  message: Record<string, bigint>
}
export interface KeeperSigner { address: Address; signTransaction(plan: TransactionSerializableLegacy): Promise<Hex> }
export interface OperatingPolicy {
  maxProjects: number; maxProjectsPerWallet: number; allowedListingIds: readonly string[]; inventorySeller: Address
  maxProcurementFabRaw: bigint; maxMinerPriceWei: bigint; maxConversionInputRaw: bigint; slippageBps: number
}
export interface RuntimeConfig {
  chainId: 1952; publicOrigin: string; rpcUrl: string; admissionEnabled: boolean; executionEnabled: boolean
  expectedSigner: Address; keeperAddress: Address | null; gasCapWei: bigint; maxGasPerTransaction: bigint
  maxGasPriceWei: bigint; expiredRecoveryHash?: Hex; policy: OperatingPolicy | null; pollMs: number | null
}
export type JobKind = 'sync' | 'fund' | 'purchase' | 'conversion'
export interface Job {
  id: string; kind: JobKind; status: 'queued' | 'waiting' | 'prepared' | 'broadcast' | 'confirmed' | 'failed' | 'blocked'
  reason: string; token?: Address; hash?: Hex; updatedAt: number
}
export interface Challenge {
  requestId: string; address: Address; form: MiningLaunchForm; message: string; expiresAt: number
  status: 'issued' | 'verified' | 'authorized' | 'registered' | 'expired'; createdAt: number
  verifiedAtBlock?: Hex
  expiryProof?: { number: Hex; hash: Hex; previousStatus: 'verified' | 'authorized' }
  authorization?: { requestId: string; form: MiningLaunchForm; expiresAt: number; tx: MiningTransaction }
}
export interface ExpiryAnchor { number: Hex; hash: Hex }
export interface ExpiryReconciliation {
  // Only a completed proof scan (or a newly proved expiry) establishes coverage.
  anchor?: ExpiryAnchor
  scan?: { snapshot: ExpiryAnchor; requestIds: string[]; cursor: number }
  pending: boolean
}
export interface Execution {
  hash: Hex; raw: Hex; signer: Address; nonce: number; to: Address; data: Hex; gas: string; gasPrice: string
  maxCostWei: string; jobId: string; status: 'prepared' | 'broadcast' | 'confirmed' | 'reverted' | 'nonce_conflict' | 'replaced'
  recoveryOf?: Hex; cancellationHash?: Hex; replacementWinner?: Hex
  receiptBlock?: Hex; receiptBlockHash?: Hex; actualCostWei?: string; deadline?: number; broadcasts: number
}
export interface PersistentState {
  schema: 1; deploymentVersion: string; revision: number; challenges: Record<string, Challenge>
  projects: Record<string, MiningProject>; jobs: Record<string, Job>; executions: Record<string, Execution>
  farm?: { capacity: number; minerCount: number; procurementBudgetFab: string };
  spentWei: string; reservedWei: string; cursor: number; requested: boolean
  authorizations: Record<string, { nonce: string; expiresAt: number }>
  // Optional for schema-1 databases written before bounded expiry reconciliation.
  admissionExpiry?: ExpiryReconciliation
}
export interface PreparedCall { to: Address; data: Hex; kind: JobKind; jobId: string; token?: Address; deadline?: number; verifiedBlock?: Block }
export class ServiceError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code) }
}
export const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
export const address = (v: unknown): v is Address => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/.test(v)
export const hash = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)
export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function quantity(v: unknown): bigint {
  if (typeof v !== 'string' || !/^0x[0-9a-f]+$/i.test(v)) throw new ServiceError('rpc_invalid', 503)
  return BigInt(v)
}
