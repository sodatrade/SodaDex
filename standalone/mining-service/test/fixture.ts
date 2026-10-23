import { decodeFunctionData, encodeFunctionResult, parseAbi, toFunctionSelector, type Abi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { MINING_PRODUCTS, type MiningProductDeployment, type MiningProject } from '../../mining-products.ts'
import { MINING_PRODUCT_READ_ABI } from '../../mining-abi.ts'
import { authorizationDigest, purchaseTyped, conversionTyped } from '../src/signatures.ts'
import { Repository, MemoryStorage } from '../src/repository.ts'
import { TEST_RPC, TEST_SIGNER } from '../src/config.ts'
import { ServiceError, type AdmissionSigner, type Discovery, type KeeperSigner, type Rpc, type RuntimeConfig } from '../src/types.ts'
export const wallet = privateKeyToAccount(`0x${'11'.repeat(32)}`)
export const authority = privateKeyToAccount(`0x${'22'.repeat(32)}`)
export const keeperAccount = privateKeyToAccount(`0x${'33'.repeat(32)}`)
export const signer: AdmissionSigner = { address: authority.address, signMessage: payload => authority.signMessage({ message: { raw: payload } }), signTypedData: value => authority.signTypedData(value) }
export const keeperSigner: KeeperSigner = { address: keeperAccount.address, signTransaction: tx => keeperAccount.signTransaction(tx) }
export const d = MINING_PRODUCTS as MiningProductDeployment
export const now = 1000
export const header = { number: '0x64' as Hex, hash: `0x${'ab'.repeat(32)}` as Hex, timestamp: 1000n }
export function config(): RuntimeConfig {
  return { chainId: 1952, publicOrigin: 'https://sodadex-mining-test-1952.jsmsdx2025.workers.dev', rpcUrl: TEST_RPC,
    admissionEnabled: true, executionEnabled: true, expectedSigner: TEST_SIGNER, keeperAddress: keeperAccount.address,
    gasCapWei: 1_000_000_000n, maxGasPerTransaction: 1_000_000n, maxGasPriceWei: 10n, pollMs: 1000,
    policy: { maxProjects: 10, maxProjectsPerWallet: 3, allowedListingIds: ['99'], inventorySeller: wallet.address,
      maxProcurementFabRaw: 100_000_000n, maxMinerPriceWei: 10000n, maxConversionInputRaw: 1000000n, slippageBps: 50 } }
}
export const discovery: Discovery = {
  async verifyBase() { return header },
  async resolveProject(_r, deployment, token) {
    const project = deployment.projects.find(item => item.token.address.toLowerCase() === token.toLowerCase())
    if (!project) throw new ServiceError('project_binding_invalid', 503)
    return project
  },
}
const extra = [
  'function isFjord() view returns(bool)', 'function isIsthmus() view returns(bool)',
  'function operatorFeeScalar() view returns(uint32)', 'function operatorFeeConstant() view returns(uint64)',
  'function getL1FeeUpperBound(uint256) view returns(uint256)', 'function getOperatorFee(uint256) view returns(uint256)',
]
const signatures = [...new Set([...Object.values(MINING_PRODUCT_READ_ABI).flat(), ...extra])]
export class FakeRpc implements Rpc {
  calls: { method: string; params: unknown[] }[] = []
  values = new Map<string, unknown>()
  receipts = new Map<string, unknown>()
  transactions = new Map<string, unknown>()
  nonce = 0n; pendingNonce = 0n; balance = 1_000_000_000_000n; simulateFailure = false; broadcastFailure = false; wrongChain = false
  sent: Hex[] = []; onBroadcast?: (raw: Hex) => void
  constructor() {
    this.set('isFjord', true); this.set('isIsthmus', true); this.set('operatorFeeScalar', 0); this.set('operatorFeeConstant', 0n)
    this.set('getL1FeeUpperBound', 0n); this.set('getOperatorFee', 0n); this.set('POOL_FEE', 0)
    this.set('LAUNCH_FACTORY', d.contracts.launchFactory.address); this.set('signer', TEST_SIGNER)
    this.set('minerCount', 1n); this.set('MAX_MINERS', 4); this.set('sourcePaused', false)
    this.set('procurementBudget', 100_000_000n); this.set('procurementSpent', 0n)
    this.set('reserved', 0n); this.set('farmPending', 0n); this.set('balanceOf', 0n)
    this.set('vaultBatchCursor', 0n); this.set('incomeBatchCount', 0n)
    this.set('usedNonce', false); this.set('usedConversionNonce', false); this.set('admissibleMiner', true)
    this.set('listingView', [wallet.address, d.contracts.circuits.address, 7n, 100n, 0, false]); this.set('taxExempt', false); this.set('taxSellBps', 100)
  }
  set(name: string, value: unknown, to?: Address): void { this.values.set(`${to?.toLowerCase() ?? '*'}:${name}`, value) }
  private value(name: string, args: readonly unknown[], to: Address): unknown {
    if (name === 'purchaseDigest') return authorizationDigest(purchaseTyped(to, args[0] as Parameters<typeof purchaseTyped>[1]))
    if (name === 'conversionDigest') return authorizationDigest(conversionTyped(to, args[0] as Parameters<typeof conversionTyped>[1]))
    const v = this.values.has(`${to.toLowerCase()}:${name}`) ? this.values.get(`${to.toLowerCase()}:${name}`) : this.values.get(`*:${name}`)
    return typeof v === 'function' ? (v as (args: readonly unknown[]) => unknown)(args) : v
  }
  async request(method: string, params: unknown[] = []): Promise<unknown> {
    this.calls.push({ method, params })
    if (method === 'eth_chainId') return this.wrongChain ? '0xc4' : '0x7a0'
    if (method === 'eth_getBlockByNumber') return { ...header, timestamp: `0x${header.timestamp.toString(16)}` }
    if (method === 'eth_getCode') return '0x'
    if (method === 'eth_getBalance') return `0x${this.balance.toString(16)}`
    if (method === 'eth_getTransactionCount') return `0x${(params[1] === 'pending' ? this.pendingNonce : this.nonce).toString(16)}`
    if (method === 'eth_estimateGas') { if (this.simulateFailure) throw new ServiceError('simulation_reverted', 422); return '0x5208' }
    if (method === 'eth_gasPrice') return '0x1'
    if (method === 'eth_getTransactionReceipt') return this.receipts.get(String(params[0])) ?? null
    if (method === 'eth_getTransactionByHash') return this.transactions.get(String(params[0])) ?? null
    if (method === 'eth_sendRawTransaction') {
      const raw = params[0] as Hex
      this.sent.push(raw); this.onBroadcast?.(raw)
      if (this.broadcastFailure) throw new ServiceError('rpc_unavailable', 503)
      const { keccak256 } = await import('viem'); return keccak256(raw)
    }
    if (method === 'eth_call') {
      const tx = params[0] as { to: Address; data: Hex }
      const sig = signatures.find(item => toFunctionSelector(item) === tx.data.slice(0, 10))
      if (!sig) { if (this.simulateFailure) throw new ServiceError('simulation_reverted', 422); return '0x' }
      const abi: Abi = parseAbi([sig]), decoded = decodeFunctionData({ abi, data: tx.data })
      const result = this.value(decoded.functionName!, decoded.args ?? [], tx.to)
      if (result === undefined) throw new Error(`Unconfigured fixture ${decoded.functionName}`)
      return encodeFunctionResult({ abi, functionName: decoded.functionName, result })
    }
    throw new Error(`Unconfigured RPC ${method}`)
  }
}
export function fixture() {
  const rpc = new FakeRpc(), storage = new MemoryStorage(), repo = new Repository(storage, d), c = config()
  return { rpc, storage, repo, c, d, discovery }
}
export function projectWith(values: Partial<MiningProject>): MiningProject { return { ...d.projects[0], ...values } }
