import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { keccak256, verifyTypedData, type Address, type Hex } from 'viem'
import { orderTypedData, type SodaLimitOrder } from '../../order-types.ts'
import { executionData } from '../src/chain.ts'
import { ChainFailure, type ExecutionPlan, type ExecutionReceipt, type NonceObservation, type OrderChain } from '../src/chain-types.ts'
import { FIXED, validateConfig, type OrdersConfig } from '../src/config.ts'
import { OrderStore } from '../src/store.ts'
export const maker = privateKeyToAccount(generatePrivateKey())
export const executor = privateKeyToAccount(generatePrivateKey())
export const settlement = '0x1111111111111111111111111111111111111111' as Address
export const stable = '0x779Ded0c9e1022225f8E0630b35a9b54bE713736' as Address
export function order(nonce = '1'): SodaLimitOrder {
  return { chainId: 196, settlement, maker: maker.address, inputToken: stable, outputToken: FIXED.wrappedNative, amountIn: '10', minAmountOut: '1', receiver: maker.address, nonce, expiry: '2000', protocol: 3, pool: { currency0: stable, currency1: FIXED.wrappedNative, fee: 100, tickSpacing: 1, hooks: '0x0000000000000000000000000000000000000000' } }
}
export const sign = async (value: SodaLimitOrder): Promise<Hex> => maker.signTypedData(orderTypedData(value, FIXED.permit2))
export class FakeChain implements OrderChain {
  timestamp = 1000; status: 0 | 1 | 2 = 0; permitNonceUsed = false; readyValue = true; failSimulation = false; failBroadcast = false; completedReceipt: ExecutionReceipt | null = null; signedNonce = 0; broadcasts: Hex[] = []; onBroadcast: (() => void) | null = null
  async ready(): Promise<boolean> { return this.readyValue }
  async observe(): Promise<NonceObservation> { return { observation: { blockNumber: '100', blockHash: `0x${'a'.repeat(64)}`, timestamp: this.timestamp }, nonceStatus: this.status, permitNonceUsed: this.permitNonceUsed } }
  async verifySignature(value: SodaLimitOrder, signature: Hex): Promise<boolean> { try { return await verifyTypedData({ address: value.maker, ...orderTypedData(value, FIXED.permit2), signature }) } catch { return false } }
  async simulate(value: SodaLimitOrder): Promise<bigint> { if (this.failSimulation) throw new ChainFailure('price'); return BigInt(value.minAmountOut) }
  async plan(value: SodaLimitOrder, signature: Hex): Promise<ExecutionPlan> { return { chainId: 196, to: settlement, data: executionData(value, signature), value: 0n, nonce: this.signedNonce, gas: 100000n, gasPrice: 2n } }
  async receipt(): Promise<ExecutionReceipt | null> { return this.completedReceipt }
  async broadcast(rawTransaction: Hex): Promise<Hex> { this.broadcasts.push(rawTransaction); this.onBroadcast?.(); if (this.failBroadcast) throw new ChainFailure('unavailable'); return keccak256(rawTransaction) }
}
export function environment(executionEnabled = false): { folder: string; path: string; config: OrdersConfig; store: OrderStore; chain: FakeChain; cleanup: () => void } {
  const folder = mkdtempSync(join(tmpdir(), 'sodadex-orders-')), path = join(folder, 'orders.sqlite')
  const config = validateConfig({ settlement, rpcUrl: 'http://127.0.0.1:31337', publicOrigin: 'http://127.0.0.1:3031', databasePath: path, localTest: true, executionEnabled, gasBudgetWei: executionEnabled ? 1000000n : 0n })
  const store = new OrderStore(path), chain = new FakeChain()
  return { folder, path, config, store, chain, cleanup: () => { try { store.close() } catch { /* A restart test may already close the first connection. */ } rmSync(folder, { recursive: true, force: true }) } }
}
