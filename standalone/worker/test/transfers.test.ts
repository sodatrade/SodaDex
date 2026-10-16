import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeFunctionData, parseAbi } from 'viem'
import { deployment, ZERO } from '../src/contracts'
import { proxyRpc } from '../src/rpc'
import { validContractRequest } from '../src/trade-requests'
import * as policy from '../../trading-policy'
const owner = deployment.owner
const recipient = '0x1111111111111111111111111111111111111111'
const token = '0x2222222222222222222222222222222222222222'
const abi = parseAbi(['function transfer(address,uint256) returns(bool)'])
const native = { from: owner, to: recipient, data: '0x', value: '0x64' }
const transfer = (to = recipient, amount = 100n): object => ({ from: owner, to: token, data: encodeFunctionData({ abi, functionName: 'transfer', args: [to as `0x${string}`, amount] }), value: '0x0' })
afterEach(() => vi.restoreAllMocks())
describe('same-chain wallet transfer simulations', () => {
  it('permits exact native and ERC20 transfers independently of swap pause without broadcasting', async () => {
    vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(false)
    for (const tx of [native, transfer()]) for (const method of ['eth_call', 'eth_estimateGas']) {
      const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ jsonrpc: '2.0', id: 7, result: '0x1' }))
      const params = method === 'eth_call' ? [tx, '0x12345'] : [tx]
      const response = await proxyRpc(new Request('https://soda.example/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params }) }), upstream)
      expect(response.status).toBe(200)
      expect(upstream).toHaveBeenCalledOnce()
      expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toEqual({ jsonrpc: '2.0', id: 7, method, params })
    }
  })
  it('rejects missing/malformed sender, zero destination, zero/negative values and extra native data', () => {
    for (const tx of [{ ...native, from: undefined }, { ...native, from: 'bad' }, { ...native, to: ZERO }, { ...native, to: 'bad' }, { ...native, value: '0x0' }, { ...native, value: '-0x1' }, { ...native, value: '0x01' }, { ...native, data: '0x00' }, { ...native, gas: '0x123' }, { ...native, value: `0x1${'0'.repeat(64)}` }]) for (const simulation of [true, false]) expect(validContractRequest(tx, simulation)).toBe(false)
  })
  it('rejects zero ERC20 amount/recipient, nonzero native value, trailing bytes and other transfer selectors', () => {
    const tx = transfer() as Record<string, string>
    const transferFrom = parseAbi(['function transferFrom(address,address,uint256)'])
    for (const candidate of [transfer(ZERO), transfer(recipient, 0n), { ...tx, value: '0x1' }, { ...tx, to: ZERO }, { ...tx, data: `${tx.data}00` }, { ...tx, from: undefined }, { ...tx, data: encodeFunctionData({ abi: transferFrom, functionName: 'transferFrom', args: [owner as `0x${string}`, recipient, 100n] }) }]) for (const simulation of [true, false]) expect(validContractRequest(candidate, simulation)).toBe(false)
  })
})
