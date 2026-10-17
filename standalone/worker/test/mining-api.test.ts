import { encodeFunctionData, encodeFunctionResult, parseAbi } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { MINING_PRODUCTS, type MiningProductDeployment } from '../../mining-products'
import { networkProfile } from '../../network-profile'
import { miningApi, miningCatalog, type MiningApiBinding } from '../src/mining-api'
import { proxyRpc } from '../src/rpc'

const base = MINING_PRODUCTS as MiningProductDeployment, profile = networkProfile('1952-mining-test')
const origin = 'https://soda.example', hash = `0x${'a'.repeat(64)}`
const identity = (n: number): object => ({ address: `0x${n.toString(16).padStart(40, '0')}`, runtimeKeccak256: hash })
const project = { symbol: 'TEST-NEW', token: identity(9301), vault: identity(9302), holder: identity(9303) }
const envelope = (value: object): object => ({ schemaVersion: 1, chainId: 1952, deploymentVersion: base.version, ...value })
const request = (path: string, body?: object): Request => new Request(`${origin}/api/mining/${path}`, {
  method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-SodaDEX-Network-Profile': '1952-mining-test' },
  body: body ? JSON.stringify(body) : undefined,
})

describe('1952 private signing service bridge', () => {
  it('uses a fixed binding path and preserves only a validated response envelope', async () => {
    const fetch = vi.fn<MiningApiBinding['fetch']>().mockResolvedValue(Response.json(envelope({ admissionEnabled: false })))
    const response = await miningApi(request('status'), { fetch }, profile)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const forwarded = fetch.mock.calls[0][0]
    expect(forwarded.url).toBe('https://mining.internal/v1/status')
    expect(forwarded.headers.get('Origin')).toBe(origin)
  })
  it('never calls the service from196 or for a mismatched frontend profile', async () => {
    const fetch = vi.fn<MiningApiBinding['fetch']>()
    expect((await miningApi(request('status'), { fetch }, networkProfile('196-test'))).status).toBe(503)
    const wrong = new Request(`${origin}/api/mining/status`, { headers: { 'X-SodaDEX-Network-Profile': '196-test' } })
    expect((await miningApi(wrong, { fetch }, profile)).status).toBe(409)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects a foreign origin, arbitrary service route, malformed or oversized input', async () => {
    const fetch = vi.fn<MiningApiBinding['fetch']>()
    expect((await miningApi(new Request(`${origin}/api/mining/status`, { headers: { Origin: 'https://evil.example' } }), { fetch }, profile)).status).toBe(403)
    expect((await miningApi(request('../sign-anything'), { fetch }, profile)).status).toBe(404)
    expect((await miningApi(request('launch', { junk: 'x'.repeat(20_000) }), { fetch }, profile)).status).toBe(413)
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([{ privateKey: 'secret' }, { execution: { rawTransaction: 'secret' } }, { signature: 'secret' }, { chainId: 196 }])('does not expose private or cross-network response fields', async (fields) => {
    const fetch = vi.fn<MiningApiBinding['fetch']>().mockResolvedValue(Response.json(envelope(fields)))
    expect((await miningApi(request('status'), { fetch }, profile)).status).toBe(503)
  })
  it('allows the exact launch calldata response, rather than rejecting its encoded authorization', async () => {
    const fetch = vi.fn<MiningApiBinding['fetch']>().mockResolvedValue(Response.json(envelope({ tx: { data: '0x1234' } })))
    expect((await miningApi(request('launch', { requestId: 'x', signature: 'wallet-proof' }), { fetch }, profile)).status).toBe(200)
  })
  it('keeps static projects when the private directory is missing, invalid or unavailable', async () => {
    expect(await miningCatalog(undefined, origin)).toBe(base)
    const fetch = vi.fn<MiningApiBinding['fetch']>().mockResolvedValue(Response.json(envelope({ projects: [{ ...project, token: {} }] })))
    expect(await miningCatalog({ fetch }, origin)).toBe(base)
  })
  it('falls back to pinned projects when the directory never responds', async () => {
    vi.useFakeTimers()
    try {
      const pending = miningCatalog({fetch: () => new Promise(() => {})}, origin)
      await vi.advanceTimersByTimeAsync(1500)
      expect(await pending).toBe(base)
    } finally { vi.useRealTimers() }
  })
  it('extends the RPC allowlist only with projects returned by the trusted binding', async () => {
    const fetch = vi.fn<MiningApiBinding['fetch']>().mockResolvedValue(Response.json(envelope({ projects: [project], revision: '2' })))
    const catalog = await miningCatalog({ fetch }, origin)
    expect(catalog.state).toBe('ready')
    if (catalog.state !== 'ready') throw new Error('Fixture')
    expect(catalog.contracts).toEqual(base.contracts)
    expect(catalog.version).toBe(base.version)
    expect(catalog.projects).toHaveLength(base.projects.length + 1)
    const abi = parseAbi(['function symbol() view returns(string)'])
    const body = { jsonrpc: '2.0', id: 'symbol', method: 'eth_call', params: [{ to: catalog.projects.at(-1)!.token.address,
      data: encodeFunctionData({ abi, functionName: 'symbol' }) }, 'latest'] }
    const rpcRequest = (): Request => new Request(`${origin}/api/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const upstream = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ jsonrpc: '2.0', id: 'network-profile', result: '0x7a0' }))
      .mockResolvedValueOnce(Response.json({ jsonrpc: '2.0', id: 'symbol', result: encodeFunctionResult({ abi, functionName: 'symbol', result: project.symbol }) }))
    expect((await proxyRpc(rpcRequest(), upstream, profile)).status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
    expect((await proxyRpc(rpcRequest(), upstream, profile, catalog)).status).toBe(200)
    expect(upstream).toHaveBeenCalledTimes(2)
  })
})
