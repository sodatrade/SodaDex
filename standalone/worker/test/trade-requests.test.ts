import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, type Address, type Hex } from 'viem'
import { validContractRequest } from '../src/trade-requests'
import deployment from '../../../deployments/xlayer-test/active.json'
import pools from '../../../deployments/xlayer-test/pools.json'
import * as policy from '../../trading-policy'
import { proxyRpc } from '../src/rpc'

beforeEach(() => { vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(true) })
afterEach(() => { vi.restoreAllMocks() })

const zero = '0x0000000000000000000000000000000000000000'
const owner = deployment.owner as Address
const stable = pools.stable.address as Address
const router = deployment.contracts.universalRouter as Address
const sentinel = '0x0000000000000000000000000000000000000002'
const execute = parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable'])
const key = [zero, stable, 0, 1, zero] as const
const pair = parseAbiParameters('address,uint256')
const sweep = encodeAbiParameters(parseAbiParameters('address,address,uint256'), [zero, owner, 0n])
const transaction = (data: Hex, value = '0x0'): object => ({ from: owner, to: router, data, value })
const call = (commands: Hex, inputs: Hex[]): Hex => encodeFunctionData({ abi: execute, functionName: 'execute', args: [commands, inputs, 2_000_000_000n] })

function v3(nativeIn: boolean): object {
  const path = (nativeIn ? deployment.wrappedNative + '000064' + stable.slice(2) : stable + '000064' + deployment.wrappedNative.slice(2)) as Hex
  const swap = encodeAbiParameters(parseAbiParameters('address,uint256,uint256,bytes,bool,uint256[]'), [nativeIn ? owner : sentinel, 100n, 90n, path, !nativeIn, []])
  const unwrap = encodeAbiParameters(pair, [owner, nativeIn ? 0n : 90n])
  return transaction(call(nativeIn ? '0x0b000c04' : '0x000c04', nativeIn ? [encodeAbiParameters(pair, [sentinel, 100n]), swap, unwrap, sweep] : [swap, unwrap, sweep]), nativeIn ? '0x64' : '0x0')
}

function v4(nativeIn: boolean, receiver: Address = owner): object {
  const exact = encodeAbiParameters(parseAbiParameters('((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)'), [[key, nativeIn, 100n, 90n, 0n, '0x']])
  const settle = encodeAbiParameters(pair, [nativeIn ? zero : stable, 100n])
  const take = encodeAbiParameters(pair, [nativeIn ? stable : zero, 90n])
  const actions = encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), ['0x060c0f', [exact, settle, take]])
  return transaction(call('0x1004', [actions, encodeAbiParameters(parseAbiParameters('address,address,uint256'), [zero, receiver, 0n])]), nativeIn ? '0x64' : '0x0')
}

describe('verified pool RPC boundary', () => {
  it('blocks old-client swap and approval simulations before upstream access while paused', async () => {
    vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(false)
    const tokenAbi = parseAbi(['function approve(address,uint256)'])
    const permitAbi = parseAbi(['function approve(address,address,uint160,uint48)'])
    const approvals = [
      { from: owner, to: deployment.permit2, data: encodeFunctionData({ abi: permitAbi, functionName: 'approve', args: [stable, router, 100n, 2_000_000_000] }) },
    ]
    for (const tx of [v3(true), v3(false), v4(true), v4(false), ...approvals]) {
      for (const method of ['eth_call', 'eth_estimateGas']) {
        const upstream = vi.fn<typeof fetch>()
        const params = method === 'eth_call' ? [tx, 'latest'] : [tx]
        const response = await proxyRpc(new Request('https://soda.example/api/rpc', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://soda.example' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }), upstream)
        expect(response.status).toBe(400)
        expect(upstream).not.toHaveBeenCalled()
      }
    }
    const reset = { from: owner, to: stable, data: encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [deployment.permit2 as Address, 0n] }) }
    expect(validContractRequest(reset, true)).toBe(true)
    expect(validContractRequest(reset, false)).toBe(true)
  })
  it('keeps receipt, balance, code and allowance reads available while paused', async () => {
    vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(false)
    const token = parseAbi(['function allowance(address,address) view returns(uint256)'])
    const permit = parseAbi(['function allowance(address,address,address) view returns(uint160,uint48,uint48)'])
    const reads = [
      { method: 'eth_getTransactionReceipt', params: [`0x${'a'.repeat(64)}`] },
      { method: 'eth_getBalance', params: [owner, 'latest'] },
      { method: 'eth_getCode', params: [router, 'latest'] },
      { method: 'eth_call', params: [{ to: stable, data: encodeFunctionData({ abi: token, functionName: 'allowance', args: [owner, deployment.permit2 as Address] }) }, 'latest'] },
      { method: 'eth_call', params: [{ to: deployment.permit2, data: encodeFunctionData({ abi: permit, functionName: 'allowance', args: [owner, stable, router] }) }, 'latest'] },
    ]
    for (const read of reads) {
      const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ jsonrpc: '2.0', id: 1, result: '0x0' }))
      const response = await proxyRpc(new Request('https://soda.example/api/rpc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...read }),
      }), upstream)
      expect(response.status).toBe(200)
      expect(upstream).toHaveBeenCalledOnce()
    }
  })
  it('simulates native/stable swaps in both directions for both exact deployed protocols', () => {
    for (const tx of [v3(true), v3(false), v4(true), v4(false)]) {
      expect(validContractRequest(tx, true)).toBe(true)
      expect(validContractRequest(tx, false)).toBe(true)
    }
  })
  it('rejects diverted recipients, destinations, mismatched values and trailing calldata', () => {
    const base = v3(true) as Record<string, string>
    for (const tx of [v4(true, stable), { ...base, to: stable }, { ...base, value: '0x65' }, { ...base, data: base.data + '00' }, { ...base, gas: '0x100' }, { ...base, from: 'bad' }]) expect(validContractRequest(tx, true)).toBe(false)
  })
  it('permits exact finite ERC20 approval/reset to Permit2 and blocks other spenders and maximum amounts', () => {
    const abi = parseAbi(['function approve(address,uint256)'])
    const approve = (spender: Address, amount: bigint): object => ({ from: owner, to: stable, data: encodeFunctionData({ abi, functionName: 'approve', args: [spender, amount] }) })
    expect(validContractRequest(approve(deployment.permit2 as Address, 100n), true)).toBe(true)
    expect(validContractRequest(approve(deployment.permit2 as Address, 0n), true)).toBe(true)
    expect(validContractRequest(approve(router, 100n), true)).toBe(false)
    expect(validContractRequest(approve(deployment.permit2 as Address, 2n ** 256n - 1n), true)).toBe(false)
  })
  it('allows only the own router Permit2 spender', () => {
    const abi = parseAbi(['function approve(address,address,uint160,uint48)'])
    const approve = (spender: Address): object => ({ from: owner, to: deployment.permit2, data: encodeFunctionData({ abi, functionName: 'approve', args: [stable, spender, 100n, 2_000_000_000] }) })
    expect(validContractRequest(approve(router), true)).toBe(true)
    expect(validContractRequest(approve(owner), true)).toBe(false)
  })
  it('quotes only the exact V3 fee and V4 key without hook payloads', () => {
    const abi = parseAbi(['function quoteExactInputSingle((address,address,uint256,uint24,uint160)) returns(uint256,uint160,uint32,uint256)'])
    const quote = (fee: number): object => ({ to: deployment.contracts.v3Quoter, data: encodeFunctionData({ abi, functionName: 'quoteExactInputSingle', args: [[stable, deployment.wrappedNative as Address, 100n, fee, 0n]] }) })
    expect(validContractRequest(quote(100), false)).toBe(true)
    expect(validContractRequest(quote(3000), false)).toBe(false)
    expect(validContractRequest(quote(100), true)).toBe(false)
    const abi4 = parseAbi(['function quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes)) returns(uint256,uint256)'])
    const quote4 = (hooks: Hex): object => ({ to: deployment.contracts.v4Quoter, data: encodeFunctionData({ abi: abi4, functionName: 'quoteExactInputSingle', args: [[key, true, 100n, hooks]] }) })
    expect(validContractRequest(quote4('0x'), false)).toBe(true)
    expect(validContractRequest(quote4('0x00'), false)).toBe(false)
  })
})
