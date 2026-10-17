import { describe, expect, it, vi } from 'vitest'
import { encodeFunctionData, parseAbi } from 'viem'
import { MINING_BASE } from '../../mining-contracts'
import { networkProfile } from '../../network-profile'
import { validMiningRead } from '../src/mining-reads'
import { proxyRpc } from '../src/rpc'

const abi = parseAbi(['function totalMined() view returns (uint256)', 'function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'])
const data = encodeFunctionData({ abi, functionName: 'totalMined' })
const profile = networkProfile('1952-mining-test')

describe('1952 base mining reads', () => {
  it('accepts only the exact deployed component and its canonical read ABI', () => {
    expect(validMiningRead({ to: MINING_BASE.mining, data })).toBe(true)
    expect(validMiningRead({ to: MINING_BASE.mining.toUpperCase().replace('0X', '0x'), data })).toBe(true)
    expect(validMiningRead({ to: MINING_BASE.fab, data })).toBe(false)
    expect(validMiningRead({ to: '0x1111111111111111111111111111111111111111', data })).toBe(false)
    expect(validMiningRead({ to: MINING_BASE.mining, data: `${data}00` })).toBe(false)
    expect(validMiningRead({ to: MINING_BASE.mining, data: data.slice(0, -2) })).toBe(false)
  })

  it('does not admit approvals, arbitrary transaction keys or state overrides', () => {
    const approval = encodeFunctionData({ abi, functionName: 'approve', args: [MINING_BASE.mining, 100n] })
    expect(validMiningRead({ to: MINING_BASE.fab, data: approval })).toBe(false)
    for (const extra of [{ from: MINING_BASE.fab }, { value: '0x0' }, { gas: '0x10000' }, { stateOverride: {} }])
      expect(validMiningRead({ to: MINING_BASE.mining, data, ...extra })).toBe(false)
  })

  it('checks chain 1952 then forwards the read without any 196 context queries', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ jsonrpc: '2.0', id: 'network-profile', result: '0x7a0' }))
      .mockResolvedValueOnce(Response.json({ jsonrpc: '2.0', id: 1, result: `0x${'0'.repeat(64)}` }))
    const request = new Request('https://soda.example/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: MINING_BASE.mining, data }, '0x123'] }) })
    expect((await proxyRpc(request, upstream, profile)).status).toBe(200)
    expect(upstream.mock.calls.map(([url]) => url)).toEqual([profile.rpcUrl, profile.rpcUrl])
    expect(JSON.parse(String(upstream.mock.calls[1][1]?.body)).params).toEqual([{ to: MINING_BASE.mining, data }, '0x123'])
  })

  it('stops before a valid contract read if the upstream is on 196', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ jsonrpc: '2.0', id: 'network-profile', result: '0xc4' }))
    const request = new Request('https://soda.example/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: MINING_BASE.mining, data }, 'latest'] }) })
    expect((await proxyRpc(request, upstream, profile)).status).toBe(502)
    expect(upstream).toHaveBeenCalledOnce()
  })
})
