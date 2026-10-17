import { afterEach, describe, expect, it, vi } from 'vitest'
import { hexToBytes, keccak256, parseTransaction, size, type Hex, type PublicClient } from 'viem'
import { ViemOrderChain } from '../src/chain.ts'
import { assertZeroAdditionalFees, assertZeroReceiptExtras, FEE_IMPLEMENTATION, FEE_IMPLEMENTATION_SHA256, FEE_IMPLEMENTATION_SLOT, FEE_ORACLE } from '../src/fees.ts'
import { OrdersKeeper } from '../src/keeper.ts'
import { OrdersService } from '../src/service.ts'
import { environment, executor, order, sign } from './fixture.ts'

const cleanups: (() => void)[] = []
afterEach(() => { vi.restoreAllMocks(); cleanups.splice(0).forEach(cleanup => cleanup()) })
function feeClient(): { client: PublicClient; rpc: { getBlockNumber: ReturnType<typeof vi.fn>; getStorageAt: ReturnType<typeof vi.fn>; getBytecode: ReturnType<typeof vi.fn>; readContract: ReturnType<typeof vi.fn> } } {
  const rpc = {
    getBlockNumber: vi.fn().mockResolvedValue(100n),
    getStorageAt: vi.fn().mockResolvedValue(`0x${'0'.repeat(24)}${FEE_IMPLEMENTATION.slice(2)}`),
    getBytecode: vi.fn().mockResolvedValue('0x6000'),
    readContract: vi.fn().mockResolvedValue(0n),
  }
  return { client: rpc as unknown as PublicClient, rpc }
}
function approveDigest(): void {
  // Unit tests isolate WebCrypto; owned Anvil/workerd integration hashes the actual pinned runtime.
  vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(new Uint8Array(hexToBytes(`0x${FEE_IMPLEMENTATION_SHA256}`)).buffer)
}
async function signedTransaction(): Promise<Hex> {
  return executor.signTransaction({ chainId: 196, type: 'legacy', to: order().settlement, data: '0x123456', gas: 100000n, gasPrice: 2n, value: 0n, nonce: 7 })
}
describe('X Layer gas-only budget preconditions', () => {
  it('pins all four fee reads to one block and checks the implementation code with WebCrypto', async () => {
    approveDigest()
    const { client, rpc } = feeClient()
    await assertZeroAdditionalFees(client, 1000, 123456n)
    expect(rpc.getBlockNumber).toHaveBeenCalledWith({ cacheTime: 0 })
    expect(rpc.getStorageAt).toHaveBeenCalledWith({ address: FEE_ORACLE, slot: FEE_IMPLEMENTATION_SLOT, blockNumber: 100n })
    expect(rpc.getBytecode).toHaveBeenCalledWith({ address: FEE_IMPLEMENTATION, blockNumber: 100n })
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: FEE_ORACLE, blockNumber: 100n, functionName: 'getL1FeeUpperBound', args: [1000n] }))
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 100n, functionName: 'getOperatorFee', args: [123456n] }))
    expect(crypto.subtle.digest).toHaveBeenCalledWith('SHA-256', new Uint8Array([0x60, 0]))
  })
  it('uses the supplied historical receipt block without fetching a newer head', async () => {
    approveDigest()
    const { client, rpc } = feeClient()
    await assertZeroAdditionalFees(client, 1010, 80000n, 99n)
    expect(rpc.getBlockNumber).not.toHaveBeenCalled()
    expect(rpc.readContract).toHaveBeenCalledTimes(2)
    expect(rpc.readContract.mock.calls.every(([args]) => args.blockNumber === 99n)).toBe(true)
  })
  it.each(['implementation', 'l1', 'operator', 'missing_code', 'rpc'] as const)('blocks a changed or unavailable %s before signing or broadcasting', async failure => {
    const { client, rpc } = feeClient()
    if (failure === 'implementation') rpc.getStorageAt.mockResolvedValue(`0x${'0'.repeat(64)}`)
    if (failure === 'l1') rpc.readContract.mockImplementation(async args => args.functionName === 'getL1FeeUpperBound' ? 1n : 0n)
    if (failure === 'operator') rpc.readContract.mockImplementation(async args => args.functionName === 'getOperatorFee' ? 1n : 0n)
    if (failure === 'missing_code') rpc.getBytecode.mockResolvedValue('0x')
    if (failure === 'rpc') rpc.getStorageAt.mockRejectedValue(Error('unavailable'))
    await expect(assertZeroAdditionalFees(client, 1000, 100000n)).rejects.toMatchObject({ kind: 'unavailable' })
  })
  it('rejects a runtime hash mismatch using actual WebCrypto', async () => {
    const { client } = feeClient()
    await expect(assertZeroAdditionalFees(client, 1000, 100000n)).rejects.toMatchObject({ kind: 'unavailable' })
  })
  it('does not cache a previously valid oracle across execution attempts', async () => {
    approveDigest()
    const { client, rpc } = feeClient()
    await assertZeroAdditionalFees(client, 1000, 100000n)
    rpc.readContract.mockResolvedValue(1n)
    await expect(assertZeroAdditionalFees(client, 1000, 100000n)).rejects.toMatchObject({ kind: 'unavailable' })
    expect(rpc.getStorageAt).toHaveBeenCalledTimes(2)
  })
  it.each([0, -1, 1.1, Number.NaN])('rejects an invalid serialized byte count %s', async bytes => {
    const { client, rpc } = feeClient()
    await expect(assertZeroAdditionalFees(client, bytes, 1n)).rejects.toMatchObject({ kind: 'unavailable' })
    expect(rpc.getBlockNumber).not.toHaveBeenCalled()
  })
  it('checks fees before returning a signing plan and again for the exact saved raw transaction', async () => {
    approveDigest()
    const env = environment(true); cleanups.push(env.cleanup)
    const { client, rpc } = feeClient()
    const sendRawTransaction = vi.fn().mockResolvedValue(`0x${'a'.repeat(64)}`)
    Object.assign(client, { estimateGas: vi.fn().mockResolvedValue(100000n), getGasPrice: vi.fn().mockResolvedValue(2n), getTransactionCount: vi.fn().mockResolvedValue(7), sendRawTransaction })
    const chain = new ViemOrderChain(env.config, client)
    const plan = await chain.plan(order(), '0x01', executor.address)
    const raw = await executor.signTransaction({ ...plan, type: 'legacy' })
    await chain.broadcast(raw)
    expect(rpc.readContract).toHaveBeenLastCalledWith(expect.objectContaining({ functionName: 'getOperatorFee', args: [plan.gas] }))
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'getL1FeeUpperBound', args: [BigInt(size(raw))] }))
    rpc.readContract.mockResolvedValue(1n)
    await expect(chain.plan(order(), '0x01', executor.address)).rejects.toMatchObject({ kind: 'unavailable' })
    await expect(chain.broadcast(raw)).rejects.toMatchObject({ kind: 'unavailable' })
    expect(sendRawTransaction).toHaveBeenCalledTimes(1)
  })
})

describe('receipt fee accounting and durable reservation', () => {
  it.each(['l1Fee', 'operatorFee', 'operatorFeeScalar', 'operatorFeeConstant'])('rejects nonzero %s rather than recording a gas-only cost', field => {
    expect(() => assertZeroReceiptExtras({ [field]: '0x1' })).toThrow()
  })
  it.each([null, 'oops', -1n, 0, '-1', {}])('rejects malformed receipt fee metadata %s', value => {
    expect(() => assertZeroReceiptExtras({ l1Fee: value })).toThrow()
  })
  it('permits absent extension fields only for the caller to pair with a historical oracle proof', () => {
    expect(() => assertZeroReceiptExtras({})).not.toThrow()
    expect(() => assertZeroReceiptExtras({ l1Fee: '0x0', operatorFee: 0n, operatorFeeScalar: '0', operatorFeeConstant: '0x00' })).not.toThrow()
  })
  it('reconstructs the actual signed transaction and verifies the receipt block before accounting', async () => {
    approveDigest()
    const env = environment(true); cleanups.push(env.cleanup)
    const raw = await signedTransaction(), hash = keccak256(raw), tx = parseTransaction(raw)
    const { client, rpc } = feeClient()
    const blockHash = `0x${'a'.repeat(64)}`
    Object.assign(client, {
      getTransactionReceipt: vi.fn().mockResolvedValue({ transactionHash: hash, blockNumber: 99n, blockHash, gasUsed: 80000n, effectiveGasPrice: 2n, status: 'reverted', logs: [] }),
      getBlock: vi.fn().mockResolvedValue({ number: 99n, hash: blockHash, timestamp: 1000n }),
      getTransaction: vi.fn().mockResolvedValue({ ...tx, hash, input: tx.data }),
    })
    expect(await new ViemOrderChain(env.config, client).receipt(hash, order())).toMatchObject({ succeeded: false, gasCostWei: 160000n })
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 99n, functionName: 'getL1FeeUpperBound', args: [BigInt(size(raw))] }))
    expect(rpc.getBlockNumber).not.toHaveBeenCalled()
    rpc.readContract.mockResolvedValue(1n)
    await expect(new ViemOrderChain(env.config, client).receipt(hash, order())).rejects.toMatchObject({ kind: 'unavailable' })
  })
  it('retains the original signed transaction and full reservation when a restart encounters changed fees', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    await new OrdersService(env.config, env.store, env.chain).accept({ order: order(), signature: await sign(order()) })
    let signs = 0
    const signer = { address: executor.address, async signTransaction(plan: Parameters<typeof executor.signTransaction>[0]) { signs++; return executor.signTransaction(plan) } }
    env.chain.failBroadcast = true
    const keeper = new OrdersKeeper(env.config, env.store, env.chain, signer)
    await keeper.runOnce()
    const original = env.store.executions()[0], committed = env.store.gasCommitted()
    const { client, rpc } = feeClient()
    const sendRawTransaction = vi.fn()
    Object.assign(client, { sendRawTransaction })
    rpc.readContract.mockResolvedValue(1n)
    env.chain.broadcast = raw => new ViemOrderChain(env.config, client).broadcast(raw)
    await keeper.runOnce()
    expect(signs).toBe(1)
    expect(sendRawTransaction).not.toHaveBeenCalled()
    expect(env.store.executions()[0]).toMatchObject({ hash: original.hash, rawTransaction: original.rawTransaction, maxCostWei: original.maxCostWei })
    expect(env.store.gasCommitted()).toBe(committed)
  })
  it('does not release a saved gas reservation when a receipt reports an unbudgeted extra fee', async () => {
    const env = environment(true); cleanups.push(env.cleanup)
    await new OrdersService(env.config, env.store, env.chain).accept({ order: order(), signature: await sign(order()) })
    env.chain.failBroadcast = true
    const signer = { address: executor.address, signTransaction: (plan: Parameters<typeof executor.signTransaction>[0]) => executor.signTransaction(plan) }
    const keeper = new OrdersKeeper(env.config, env.store, env.chain, signer)
    await keeper.runOnce()
    const original = env.store.executions()[0], committed = env.store.gasCommitted()
    const client = { getTransactionReceipt: vi.fn().mockResolvedValue({ transactionHash: original.hash, l1Fee: '0x1' }) } as unknown as PublicClient
    env.chain.receipt = hash => new ViemOrderChain(env.config, client).receipt(hash!, order())
    await expect(keeper.runOnce()).rejects.toMatchObject({ kind: 'unavailable' })
    expect(env.store.executions()[0]).toMatchObject({ hash: original.hash, maxCostWei: original.maxCostWei })
    expect(env.store.gasCommitted()).toBe(committed)
  })
})
