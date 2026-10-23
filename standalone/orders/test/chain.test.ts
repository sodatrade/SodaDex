import { describe, expect, it, vi } from 'vitest'
import { ContractFunctionRevertedError, encodeErrorResult, type PublicClient } from 'viem'
import { ViemOrderChain, orderId } from '../src/chain.ts'
import { SETTLEMENT_ABI } from '../src/abi.ts'
import { environment, order } from './fixture.ts'
describe('ERC1271 typed signature adapter', () => {
  it('uses publicClient verification at the observed block for a deployed contract maker', async () => {
    const env = environment()
    try {
      const value = order(), at = (await env.chain.observe()).observation
      const verify = vi.fn().mockResolvedValue(true)
      const client = { getBytecode: vi.fn().mockResolvedValue('0x6000'), readContract: vi.fn().mockResolvedValue(orderId(value)), verifyTypedData: verify, getBlock: vi.fn().mockResolvedValue({ hash: at.blockHash }) } as unknown as PublicClient
      const adapter = new ViemOrderChain(env.config, client)
      expect(await adapter.verifySignature(value, '0x01', at)).toBe(true)
      expect(verify).toHaveBeenCalledWith(expect.objectContaining({ address: value.maker, blockNumber: 100n, primaryType: 'PermitWitnessTransferFrom' }))
      verify.mockResolvedValue(false)
      expect(await adapter.verifySignature(value, '0x01', at)).toBe(false)
    } finally { env.cleanup() }
  })
  it('rejects reorganization during pinned nonce reads instead of stamping inconsistent state', async () => {
    const env = environment()
    try {
      const value = order(), at = (await env.chain.observe()).observation
      const client = {
        getBlock: vi.fn().mockResolvedValueOnce({ number: 100n, hash: at.blockHash, timestamp: 1000n }).mockResolvedValueOnce({ hash: `0x${'b'.repeat(64)}` }),
        readContract: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0n),
      } as unknown as PublicClient
      await expect(new ViemOrderChain(env.config, client).observe(value)).rejects.toMatchObject({ kind: 'unavailable' })
    } finally { env.cleanup() }
  })
  it('identifies the pinned Router minimum errors but keeps unknown reverts separate', async () => {
    const env = environment()
    try {
      const inner = encodeErrorResult({ abi: SETTLEMENT_ABI, errorName: 'V3TooLittleReceived' })
      const data = encodeErrorResult({ abi: SETTLEMENT_ABI, errorName: 'ExecutionFailed', args: [0n, inner] })
      const simulateContract = vi.fn().mockRejectedValue(new ContractFunctionRevertedError({ abi: SETTLEMENT_ABI, functionName: 'execute', data }))
      const adapter = new ViemOrderChain(env.config, { simulateContract } as unknown as PublicClient)
      await expect(adapter.simulate(order(), '0x01', order().maker)).rejects.toMatchObject({ kind: 'price' })
      const unknown = encodeErrorResult({ abi: SETTLEMENT_ABI, errorName: 'ExecutionFailed', args: [0n, '0x12345678'] })
      simulateContract.mockRejectedValue(new ContractFunctionRevertedError({ abi: SETTLEMENT_ABI, functionName: 'execute', data: unknown }))
      await expect(adapter.simulate(order(), '0x01', order().maker)).rejects.toMatchObject({ kind: 'simulation' })
    } finally { env.cleanup() }
  })
  it('compares an old terminal block header against the canonical pinned snapshot', async () => {
    const env = environment()
    try {
      const at = (await env.chain.observe()).observation
      const getBlock = vi.fn().mockResolvedValueOnce({ number: 101n, hash: `0x${'b'.repeat(64)}`, timestamp: 1001n })
        .mockResolvedValueOnce({ hash: `0x${'c'.repeat(64)}` }).mockResolvedValueOnce({ hash: `0x${'b'.repeat(64)}` })
      const client = { getBlock, readContract: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0n) } as unknown as PublicClient
      const state = await new ViemOrderChain(env.config, client).observe(order(), at)
      expect(state.previousObservationCanonical).toBe(false)
      expect(state.observation.blockNumber).toBe('101')
      expect(getBlock).toHaveBeenNthCalledWith(2, { blockNumber: 100n })
      expect(getBlock).toHaveBeenNthCalledWith(3, { blockNumber: 101n })
    } finally { env.cleanup() }
  })
  it('does not pretend an unavailable old header proves the terminal block canonical', async () => {
    const env = environment()
    try {
      const at = (await env.chain.observe()).observation
      const getBlock = vi.fn().mockResolvedValueOnce({ number: 101n, hash: `0x${'b'.repeat(64)}`, timestamp: 1001n })
        .mockRejectedValueOnce(Error('old header unavailable')).mockResolvedValueOnce({ hash: `0x${'b'.repeat(64)}` })
      const client = { getBlock, readContract: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0n) } as unknown as PublicClient
      expect((await new ViemOrderChain(env.config, client).observe(order(), at)).previousObservationCanonical).toBeNull()
    } finally { env.cleanup() }
  })
  it('checks a confirmed keeper nonce against a canonical block rather than a pending mempool nonce', async () => {
    const env = environment()
    try {
      const at = (await env.chain.observe()).observation
      const getTransactionCount = vi.fn().mockResolvedValue(3)
      const client = { getBlock: vi.fn().mockResolvedValue({ number: 100n, hash: at.blockHash, timestamp: 1000n }), getTransactionCount } as unknown as PublicClient
      expect(await new ViemOrderChain(env.config, client).keeperNonce(order().maker)).toMatchObject({ nonce: 3, observation: at })
      expect(getTransactionCount).toHaveBeenCalledWith({ address: order().maker, blockNumber: 100n })
    } finally { env.cleanup() }
  })
})
