import { describe, expect, it, vi } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, parseAbiParameters, toHex, type Hex } from 'viem'
import { normalizeMiningLaunchForm } from '../../mining-signed-calls.ts'
import { Admission } from '../src/admission.ts'
import { Repository } from '../src/repository.ts'
import { HttpRpc } from '../src/rpc.ts'
import { type Challenge, ServiceError } from '../src/types.ts'
import { authority, d, fixture, signer, wallet } from './fixture.ts'

const form = normalizeMiningLaunchForm({ name: 'Expiry history', symbol: 'expiry', metadataURI: '' })
const h = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`
const requestId = (n: number): string => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`
function setup(count: number, distinct = false) {
  const f = fixture(); f.c.expectedSigner = authority.address
  const head = { number: '0x64' as Hex, hash: h(100), timestamp: 1400n }
  let failLogs = false, failHeaders = false
  const headerCalls: string[] = [], logs: unknown[] = []
  vi.spyOn(f.rpc, 'request').mockImplementation(async (method, params = []) => {
    if (method === 'eth_getBlockByNumber') {
      if (failHeaders) throw new ServiceError('rpc_unavailable', 503)
      const number = String(params[0]); headerCalls.push(number)
      return { number, hash: number === head.number ? head.hash : h(Number(BigInt(number))), timestamp: '0x578' }
    }
    if (method === 'eth_getLogs') { if (failLogs) throw new ServiceError('rpc_unavailable', 503); return logs }
    throw new Error(`Unexpected ${method}`)
  })
  f.repo.change(s => {
    for (let n = 1; n <= count; n++) {
      const proofNumber = distinct ? n : 1, id = requestId(n)
      const c: Challenge = { requestId: id, address: wallet.address, form, message: 'signed fixture', createdAt: 1000, expiresAt: 1300,
        status: 'expired', verifiedAtBlock: '0x1', expiryProof: { number: toHex(proofNumber), hash: h(proofNumber), previousStatus: 'authorized' },
        authorization: { requestId: id, form, expiresAt: 1300, tx: { from: wallet.address, to: d.contracts.manager.address, data: '0x', value: '0x0' } } }
      s.challenges[id] = c
    }
  })
  const source = { ...f.discovery, verifyBase: async () => ({ ...head }),
    resolveProject: (...args: Parameters<typeof f.discovery.resolveProject>) => f.discovery.resolveProject(...args) }
  const restart = (): Admission => new Admission(f.c, d, new Repository(f.storage, d), f.rpc, source, signer, () => 1400)
  return { ...f, head, headerCalls, logs, restart, failLogs: (v: boolean): void => { failLogs = v },
    failHeaders: (v: boolean): void => { failHeaders = v } }
}

describe('bounded admission expiry history', () => {
  it.each([false, true])('bounds expiry-specific upstream fetches with 46 legacy proofs (distinct=%s)', async distinct => {
    const f = setup(46, distinct), upstream = f.rpc.request.bind(f.rpc)
    let fetches = 0, finished = false
    const rpc = new HttpRpc('https://example.invalid/', async (_input, init) => {
      if (++fetches > 45) throw new ServiceError('rpc_event_budget', 503)
      const calls = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] }[]
      return Response.json(await Promise.all(calls.map(async c => ({ jsonrpc: '2.0', id: c.id, result: await upstream(c.method, c.params) }))))
    })
    for (let attempt = 0; attempt < 10 && !finished; attempt++) {
      fetches = 0
      // Base discovery is a separate fixture here: this count covers the expiry
      // algorithm's overhead, including the real HttpRpc batching/canonical reads.
      const admission = new Admission(f.c, d, new Repository(f.storage, d), rpc, { ...f.discovery, verifyBase: async () => ({ ...f.head }) }, signer, () => 1400)
      try { await admission.reconcileExpired(); finished = true }
      catch (error) { expect(error).toMatchObject({ code: 'expiry_reconciliation_pending' }) }
      expect(fetches).toBeLessThanOrEqual(3)
    }
    expect(finished).toBe(true)
  })

  it('checks 46 same-block legacy proofs once and then reuses a verified ancestor anchor', async () => {
    const f = setup(46)
    await f.restart().reconcileExpired()
    expect(f.headerCalls.filter(n => n === '0x1')).toHaveLength(1)
    expect(f.headerCalls.length).toBeLessThan(5)
    f.headerCalls.length = 0
    await f.restart().reconcileExpired()
    expect(f.headerCalls.length).toBeLessThan(4)
    expect(f.headerCalls).not.toContain('0x1')
    expect(Object.values(f.repo.read().challenges).every(c => c.status === 'expired')).toBe(true)
    expect(() => f.restart().challenge(wallet.address, requestId(1), form)).toThrow('challenge_expired')
  })

  it('durably resumes different-block legacy history under a fixed snapshot and fails closed until complete', async () => {
    const f = setup(46, true)
    let pending = 0
    const allHeaders: string[] = []
    for (let attempt = 0; attempt < 10; attempt++) {
      f.headerCalls.length = 0
      let complete = false
      try { await f.restart().reconcileExpired(); complete = true } catch (error) {
        expect(error).toMatchObject({ code: 'expiry_reconciliation_pending', status: 503 })
        pending++
        expect(() => f.restart().challenge(authority.address, requestId(999), form)).toThrow('expiry_reconciliation_pending')
      }
      expect(f.headerCalls.length).toBeLessThanOrEqual(11)
      allHeaders.push(...f.headerCalls)
      if (complete) break
    }
    expect(pending).toBeGreaterThan(0); expect(pending).toBeLessThan(10)
    expect(allHeaders.filter(n => n !== f.head.number)).toHaveLength(46)
    expect(new Set(allHeaders.filter(n => n !== f.head.number)).size).toBe(46)
    expect(f.restart().challenge(authority.address, requestId(999), form).status).toBe('issued')
    expect(Object.values(f.repo.read().challenges).filter(c => c.status === 'expired')).toHaveLength(46)
  })

  it('retains the durable cursor on an RPC failure and restores all slots if the migration snapshot reorgs', async () => {
    const f = setup(46, true)
    await expect(f.restart().reconcileExpired()).rejects.toThrow('expiry_reconciliation_pending')
    const progress = f.repo.read().admissionExpiry!.scan!.cursor
    expect(progress).toBe(8)
    f.failHeaders(true)
    await expect(f.restart().reconcileExpired()).rejects.toThrow('rpc_unavailable')
    expect(f.repo.read().admissionExpiry!.scan!.cursor).toBe(progress)
    f.failHeaders(false); f.head.hash = h(999); f.failLogs(true)
    await expect(f.restart().reconcileExpired()).rejects.toThrow('rpc_unavailable')
    expect(f.repo.read().admissionExpiry!.scan).toBeUndefined()
    expect(Object.values(f.repo.read().challenges).every(c => c.status === 'authorized' && !c.expiryProof)).toBe(true)
  })

  it('anchors each completed batch at its newer head before accepting mixed-height proof history', async () => {
    const f = setup(17, true), heights = [1, 2, 3, 4, 5, 6, 7, 8, 144, 145, 146, 147, 148, 149, 150, 151, 10]
    f.repo.change(s => heights.forEach((height, index) => {
      s.challenges[requestId(index + 1)].expiryProof = { number: toHex(height), hash: h(height), previousStatus: 'authorized' }
    }))
    // Dictionary order puts 0x90..0x97 between 0x8 and 0xa. The second
    // batch therefore validates blocks above the first snapshot's height.
    await expect(f.restart().reconcileExpired()).rejects.toThrow('expiry_reconciliation_pending')
    expect(f.repo.read().admissionExpiry!.scan!.cursor).toBe(8)
    f.head.number = toHex(200); f.head.hash = h(200)
    await expect(f.restart().reconcileExpired()).rejects.toThrow('expiry_reconciliation_pending')
    expect(f.repo.read().admissionExpiry!.scan!.cursor).toBe(16)
    expect(f.repo.read().admissionExpiry!.scan!.snapshot).toEqual({ number: toHex(200), hash: h(200) })

    const implementation = vi.mocked(f.rpc.request).getMockImplementation()!
    vi.mocked(f.rpc.request).mockImplementation(async (method, params) => {
      const value = await implementation(method, params)
      if (method !== 'eth_getBlockByNumber' || params?.[0] === f.head.number || BigInt(String(params?.[0])) <= 100n) return value
      return { ...(value as object), hash: h(Number(BigInt(String(params?.[0]))) + 1000) }
    })
    f.head.number = toHex(201); f.head.hash = h(201); f.failLogs(true)
    await expect(f.restart().reconcileExpired()).rejects.toThrow('rpc_unavailable')
    expect(Object.values(f.repo.read().challenges).every(c => c.status === 'authorized' && !c.expiryProof)).toBe(true)
    expect(f.repo.read().admissionExpiry).toEqual({ pending: true })
    expect(() => f.restart().challenge(authority.address, requestId(999), form)).toThrow('expiry_reconciliation_pending')
  })

  it('restores reservations when the final canonical check detects a mid-scan reorg', async () => {
    const f = setup(46), implementation = vi.mocked(f.rpc.request).getMockImplementation()!
    vi.mocked(f.rpc.request).mockImplementation(async (method, params) => {
      const value = await implementation(method, params)
      return method === 'eth_getBlockByNumber' && params?.[0] === f.head.number ? { ...(value as object), hash: h(999) } : value
    })
    await expect(f.restart().reconcileExpired()).rejects.toThrow('chain_reorg')
    expect(Object.values(f.repo.read().challenges).every(c => c.status === 'authorized' && !c.expiryProof)).toBe(true)
    expect(() => f.restart().challenge(authority.address, requestId(999), form)).toThrow('expiry_reconciliation_pending')
  })

  it('never trusts an old proof merely because a later legacy proof is canonical', async () => {
    const f = setup(2, true)
    f.repo.change(s => { s.challenges[requestId(1)].expiryProof!.hash = h(999) })
    f.failLogs(true)
    await expect(f.restart().reconcileExpired()).rejects.toThrow('rpc_unavailable')
    expect(Object.values(f.repo.read().challenges).map(c => c.status)).toEqual(['authorized', 'authorized'])
    expect(() => f.restart().challenge(authority.address, requestId(999), form)).toThrow('expiry_reconciliation_pending')
  })

  it('restores every affected reservation before a reorg RPC failure and recovers a re-mined project across restart', async () => {
    const f = setup(46)
    await f.restart().reconcileExpired()
    f.head.hash = h(999); f.failLogs(true)
    await expect(f.restart().reconcileExpired()).rejects.toThrow('rpc_unavailable')
    expect(Object.values(f.repo.read().challenges).every(c => c.status === 'authorized' && !c.expiryProof)).toBe(true)
    expect(() => f.restart().challenge(authority.address, requestId(999), form)).toThrow('expiry_reconciliation_pending')

    const project = { ...d.projects[0], symbol: form.symbol }
    f.discovery.resolveProject = async () => project
    const salt = keccak256(toHex(`${d.version}:${wallet.address.toLowerCase()}:${requestId(1)}`))
    f.logs.push({ address: d.contracts.launchFactory.address, blockNumber: f.head.number, blockHash: f.head.hash,
      topics: encodeEventTopics({ abi: parseAbi(['event TokenDeployed(address indexed token,address indexed manager,bytes32 salt)']),
        eventName: 'TokenDeployed', args: { token: project.token.address, manager: d.contracts.manager.address } }),
      data: encodeAbiParameters(parseAbiParameters('bytes32'), [salt]) })
    f.failLogs(false)
    await expect(f.restart().reconcileExpired()).rejects.toMatchObject({ code: 'expiry_reconciliation_pending' })
    expect(f.repo.read().challenges[requestId(1)].status).toBe('registered')
    expect(f.repo.read().projects[project.token.address.toLowerCase()]).toEqual(project)
    expect(Object.values(f.repo.read().challenges).filter(c => c.status === 'authorized')).toHaveLength(45)
    for (let n = 0; n < 45; n++) {
      try { await f.restart().reconcileExpired() } catch (error) { expect(error).toMatchObject({ code: 'expiry_reconciliation_pending' }) }
    }
    expect(Object.values(f.repo.read().challenges).filter(c => c.status === 'expired')).toHaveLength(45)
    expect(f.repo.read().admissionExpiry!.pending).toBe(false)
    expect(() => f.restart().challenge(wallet.address, requestId(1), form)).toThrow('challenge_expired')
    expect(() => f.restart().challenge(wallet.address, requestId(2), form)).toThrow('challenge_expired')
  })
})
