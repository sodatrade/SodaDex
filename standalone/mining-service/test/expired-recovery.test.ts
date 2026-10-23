import { afterEach, describe, expect, it, vi } from 'vitest'
import { keccak256, parseTransaction, toHex, type Hex } from 'viem'
import { HttpRpc } from '../src/rpc.ts'
import { Keeper } from '../src/keeper.ts'
import { Planner } from '../src/planner.ts'
import { Repository } from '../src/repository.ts'
import { fixture, d, now, keeperSigner, signer, header } from './fixture.ts'
afterEach(() => vi.restoreAllMocks())
async function setup() {
  const f = fixture(), p = d.projects[0]
  f.discovery = { ...f.discovery }
  f.c.expectedSigner = signer.address
  f.c.gasCapWei = 10_000_000_000_000n; f.c.maxGasPriceWei = 30_000_000n
  f.rpc.balance = 100_000_000_000_000n
  f.rpc.set('balanceOf', 1000n, p.token.address); f.rpc.set('getAmountsOut', [990n, 1000n])
  const planner = new Planner(f.c, d, f.repo, f.rpc, f.discovery, signer, () => now)
  const sign = vi.fn(keeperSigner.signTransaction)
  const keeper = new Keeper(f.c, d, f.repo, f.rpc, planner, { ...keeperSigner, signTransaction: sign }, () => now)
  await keeper.runOnce()
  const original = Object.values(f.repo.read().executions)[0]
  f.c.expiredRecoveryHash = original.hash
  let timestamp = 1061n
  const request = f.rpc.request.bind(f.rpc)
  vi.spyOn(f.rpc, 'request').mockImplementation((m, params) => m === 'eth_getBlockByNumber' ? Promise.resolve({ ...header, timestamp: toHex(timestamp) }) : request(m, params))
  vi.spyOn(f.discovery, 'verifyBase').mockImplementation(async () => ({ ...header, timestamp }))
  return { ...f, planner, keeper, original, sign, setTimestamp: (t: bigint) => { timestamp = t },
    restarted: () => new Keeper(f.c, d, new Repository(f.storage, d), f.rpc, planner, { ...keeperSigner, signTransaction: sign }, () => now) }
}
function receipt(hash: Hex, status = '0x1') {
  return { transactionHash: hash, status, blockNumber: header.number, blockHash: header.hash, gasUsed: '0x5208', effectiveGasPrice: '0x1', l1Fee: '0x0', operatorFee: '0x0' }
}
describe('one approved expired authorization nonce cancellation', () => {
  it('uses chain time, persists a separate fixed zero-value self transfer and both reserves before broadcast', async () => {
    const f = await setup()
    f.rpc.onBroadcast = raw => {
      const e = f.repo.read().executions[keccak256(raw)]
      expect(e.recoveryOf).toBe(f.original.hash)
      expect(f.repo.read().executions[f.original.hash].cancellationHash).toBe(e.hash)
      expect(BigInt(f.repo.read().reservedWei)).toBe(BigInt(e.maxCostWei) + BigInt(f.original.maxCostWei))
    }
    await f.keeper.runOnce()
    const cancel = Object.values(f.repo.read().executions).find(e => e.recoveryOf)!
    expect(cancel).toBeDefined()
    expect(parseTransaction(cancel.raw)).toMatchObject({ chainId: 1952, nonce: f.original.nonce, to: keeperSigner.address.toLowerCase(), gasPrice: 30_000_000n })
    expect(parseTransaction(cancel.raw).value ?? 0n).toBe(0n); expect(parseTransaction(cancel.raw).data ?? '0x').toBe('0x')
    expect(f.rpc.sent).toEqual([f.original.raw, cancel.raw])
    expect(f.repo.read().executions[f.original.hash].raw).toBe(f.original.raw)
  })
  it('blocks active deadline including equality even when server clock says expired', async () => {
    const f = await setup(); f.setTimestamp(1060n)
    await expect(f.keeper.runOnce()).rejects.toThrow('recovery_authorization_active')
    expect(f.sign).toHaveBeenCalledTimes(1); expect(f.repo.read().reservedWei).toBe(f.original.maxCostWei)
  })
  it('blocks used business nonces, changed runtime, nonempty keeper code, unknown nonce and pending conflicts', async () => {
    for (const reason of ['used', 'runtime', 'code', 'nonce', 'pending']) {
      const f = await setup()
      if (reason === 'used') f.rpc.set('usedConversionNonce', true)
      if (reason === 'runtime') vi.spyOn(f.discovery, 'resolveProject').mockRejectedValue(new Error('runtime_changed'))
      if (reason === 'code') { const r = f.rpc.request.bind(f.rpc); vi.spyOn(f.rpc, 'request').mockImplementation((m, p) => m === 'eth_getCode' ? Promise.resolve('0x6000') : r(m, p)) }
      if (reason === 'nonce') { f.rpc.nonce = 1n; f.rpc.pendingNonce = 1n }
      if (reason === 'pending') f.rpc.pendingNonce = 1n
      await f.keeper.runOnce().catch(() => undefined)
      expect(f.sign).toHaveBeenCalledTimes(1); expect(f.rpc.sent).toEqual([f.original.raw]); expect(f.repo.read().spentWei).toBe('0')
    }
  })
  it('requires the full additional cancellation reserve and a replaceable price within the existing cap', async () => {
    const f = await setup(); f.c.gasCapWei = BigInt(f.original.maxCostWei) + 1n
    await expect(f.keeper.runOnce()).rejects.toThrow('gas_budget_exhausted')
    expect(f.sign).toHaveBeenCalledTimes(1); expect(f.repo.read().reservedWei).toBe(f.original.maxCostWei)
  })
  it('never signs another cancellation after response loss/restart and rebroadcasts only exact cancellation bytes once', async () => {
    const f = await setup(); f.rpc.broadcastFailure = true; await f.keeper.runOnce()
    const cancel = Object.values(f.repo.read().executions).find(e => e.recoveryOf)!
    await f.restarted().runOnce(); await f.restarted().runOnce()
    expect(f.sign).toHaveBeenCalledTimes(2); expect(f.rpc.sent).toEqual([f.original.raw, cancel.raw, cancel.raw])
    expect(f.repo.read().reservedWei).toBe(String(BigInt(cancel.maxCostWei) + BigInt(f.original.maxCostWei)))
  })
  it('settles only the canonical winner and releases both reservations exactly once', async () => {
    for (const originalWins of [false, true]) {
      const f = await setup(); await f.keeper.runOnce()
      const cancel = Object.values(f.repo.read().executions).find(e => e.recoveryOf)!
      const winner = originalWins ? f.original : cancel, loser = originalWins ? cancel : f.original
      f.rpc.receipts.set(winner.hash, receipt(winner.hash)); f.rpc.nonce = 1n; f.rpc.pendingNonce = 1n
      await f.keeper.runOnce()
      expect(f.repo.read().spentWei).toBe('21000'); expect(f.repo.read().reservedWei).toBe('0')
      expect(f.repo.read().executions[winner.hash].status).toBe('confirmed')
      expect(f.repo.read().executions[loser.hash].status).toBe('replaced')
      expect(f.repo.read().executions[loser.hash].replacementWinner).toBe(winner.hash)
      f.repo.change(s => { s.cursor = d.projects.length }); f.rpc.set('minerCount', 4n)
      await f.keeper.runOnce()
      expect(f.repo.read().spentWei).toBe('21000'); expect(f.sign).toHaveBeenCalledTimes(2)
    }
  })
  it('retains both reserves on missing or conflicting canonical receipt evidence', async () => {
    const f = await setup(); await f.keeper.runOnce()
    const cancel = Object.values(f.repo.read().executions).find(e => e.recoveryOf)!
    f.rpc.nonce = 1n; f.rpc.pendingNonce = 1n
    await f.keeper.runOnce()
    expect(f.repo.read().reservedWei).toBe(String(BigInt(cancel.maxCostWei) + BigInt(f.original.maxCostWei)))
    f.rpc.receipts.set(f.original.hash, receipt(f.original.hash)); f.rpc.receipts.set(cancel.hash, receipt(cancel.hash))
    await expect(f.keeper.runOnce()).rejects.toThrow('recovery_winner_conflict')
    expect(f.repo.read().spentWei).toBe('0')
  })
  it('rejects mutated deadline metadata and arbitrary transfer bytes even if stored fields match them', async () => {
    const f = await setup(); f.repo.change(s => { s.executions[f.original.hash].deadline = 1 })
    await expect(f.keeper.runOnce()).rejects.toThrow('recovery_deadline_mismatch')
    expect(f.sign).toHaveBeenCalledTimes(1)
    f.repo.change(s => { s.executions[f.original.hash].deadline = f.original.deadline }); await f.keeper.runOnce()
    const cancel = Object.values(f.repo.read().executions).find(e => e.recoveryOf)!
    const raw = await keeperSigner.signTransaction({ to: d.contracts.fab.address, nonce: cancel.nonce, gas: BigInt(cancel.gas), gasPrice: BigInt(cancel.gasPrice), value: 0n, type: 'legacy', chainId: 1952 })
    f.repo.change(s => { s.executions[cancel.hash] = { ...cancel, raw, to: d.contracts.fab.address } })
    await expect(f.keeper.runOnce()).rejects.toThrow('cancellation_transaction_invalid')
  })
  it('leaves non-allowlisted expired calls blocked, never widening ordinary call policy or chain scope', async () => {
    const f = await setup(); f.c.expiredRecoveryHash = undefined
    await f.keeper.runOnce().catch(() => undefined); expect(f.sign).toHaveBeenCalledTimes(1)
    f.c.expiredRecoveryHash = f.original.hash; f.rpc.wrongChain = true
    await expect(f.keeper.runOnce()).rejects.toThrow('wrong_chain'); expect(f.sign).toHaveBeenCalledTimes(1)
  })
  it('runs cancellation through the real batched HttpRpc without weakening the empty-code pending guard', async () => {
    const f = await setup()
    const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const operations = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] }[]
      return Response.json(await Promise.all(operations.map(async o => ({ id: o.id, jsonrpc: '2.0', result: await f.rpc.request(o.method, o.params) }))))
    })
    const rpc = new HttpRpc('https://example.invalid', fetcher)
    const keeper = new Keeper(f.c, d, f.repo, rpc, f.planner, { ...keeperSigner, signTransaction: f.sign }, () => now)
    await keeper.runOnce()
    const calls = f.rpc.calls.filter(c => ['eth_call', 'eth_estimateGas'].includes(c.method) && (c.params[0] as { to: string }).to === keeperSigner.address)
    expect(calls).toHaveLength(2); expect(calls.every(c => c.params[1] === header.number)).toBe(true)
    expect(Object.values(f.repo.read().executions).filter(e => e.recoveryOf)).toHaveLength(1)
    // Real readonly 1952 measurement at block0x29cd0d3: verifyBase12 + resolveProject10.
    // This fixture exercises the remaining real HttpRpc batching (12), plus2 for a settled ancestor.
    expect(fetcher.mock.calls).toHaveLength(12)
    expect(fetcher.mock.calls.length + 22 + 2).toBeLessThanOrEqual(45)
  })
  it('keeps the first fresh conversion transport inside the same event ceiling with the measured discovery baseline', async () => {
    const f = await setup()
    f.repo.change(s => { s.executions = {}; s.reservedWei = '0'; s.cursor = 0; s.authorizations = {} })
    f.c.expiredRecoveryHash = undefined
    const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const operations = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] }[]
      return Response.json(await Promise.all(operations.map(async o => {
        let result = await f.rpc.request(o.method, o.params)
        if (o.method === 'eth_getCode') result = '0x6000' // ordinary contract pending proof
        return { id: o.id, jsonrpc: '2.0', result }
      })))
    })
    const rpc = new HttpRpc('https://example.invalid', fetcher)
    const planner = new Planner(f.c, d, f.repo, rpc, f.discovery, signer, () => now)
    const keeper = new Keeper(f.c, d, f.repo, rpc, planner, { ...keeperSigner, signTransaction: f.sign }, () => now)
    await keeper.runOnce()
    expect(Object.values(f.repo.read().executions)).toHaveLength(1)
    expect(fetcher.mock.calls).toHaveLength(21)
    expect(fetcher.mock.calls.length + 22 + 2).toBeLessThanOrEqual(45)
  })
  it('loads an old schema-1 pending execution and preserves its prior fee history after restart', async () => {
    const f = await setup()
    f.repo.change(s => { s.spentWei = '123456'; delete s.admissionExpiry })
    const old = f.storage.load()!
    const restarted = f.restarted()
    expect(f.storage.load()).toBe(old)
    await restarted.runOnce()
    const state = f.repo.read()
    expect(state.schema).toBe(1); expect(state.spentWei).toBe('123456')
    expect(state.executions[f.original.hash].raw).toBe(f.original.raw)
    expect(Object.values(state.executions).filter(e => e.recoveryOf)).toHaveLength(1)
  })
  it('stops without a second signature if the original cannot be replaced at the approved fixed price', async () => {
    const f = await setup()
    const raw = await keeperSigner.signTransaction({ type: 'legacy', chainId: 1952, to: f.original.to, data: f.original.data,
      gas: BigInt(f.original.gas), gasPrice: 30_000_000n, nonce: f.original.nonce, value: 0n })
    const hash = keccak256(raw), replaced = { ...f.original, hash, raw, gasPrice: '30000000', maxCostWei: String(BigInt(f.original.gas) * 30_000_000n) }
    f.repo.change(s => { delete s.executions[f.original.hash]; s.executions[hash] = replaced; s.reservedWei = replaced.maxCostWei })
    f.c.expiredRecoveryHash = hash
    await expect(f.keeper.runOnce()).rejects.toThrow('cancellation_price_unavailable')
    expect(f.sign).toHaveBeenCalledTimes(1); expect(f.rpc.sent).toHaveLength(1)
  })
  it('does not create another prepared keeper row when slow validation has consumed the signature lifetime', async () => {
    const f = fixture(), p = d.projects[0]
    f.c.expectedSigner = signer.address; f.rpc.set('balanceOf', 1000n, p.token.address); f.rpc.set('getAmountsOut', [990n, 1000n])
    const planner = new Planner(f.c, d, f.repo, f.rpc, { ...f.discovery }, signer, () => now)
    const request = f.rpc.request.bind(f.rpc)
    let slow = false
    vi.spyOn(f.rpc, 'request').mockImplementation((m, params) => {
      if (m === 'eth_getTransactionCount') slow = true
      if (m === 'eth_getBlockByNumber' && slow && params?.[0] === 'latest') return Promise.resolve({ ...header, timestamp: '0x422' }) // 1058
      return request(m, params)
    })
    const sign = vi.fn(keeperSigner.signTransaction)
    const keeper = new Keeper(f.c, d, f.repo, f.rpc, planner, { ...keeperSigner, signTransaction: sign }, () => now)
    await expect(keeper.runOnce()).rejects.toThrow('authorization_expiring')
    expect(sign).not.toHaveBeenCalled(); expect(f.repo.read().executions).toEqual({}); expect(f.repo.read().reservedWei).toBe('0')
  })
  it('restores both linked reserves and reverses winner cost atomically on a reorg before any new planning', async () => {
    const f = await setup(); await f.keeper.runOnce()
    const cancel = Object.values(f.repo.read().executions).find(e => e.recoveryOf)!
    f.rpc.receipts.set(cancel.hash, receipt(cancel.hash)); await f.keeper.runOnce()
    f.rpc.receipts.delete(cancel.hash)
    const request = Object.getPrototypeOf(f.rpc).request.bind(f.rpc), changed = `0x${'cd'.repeat(32)}` as Hex
    vi.spyOn(f.rpc, 'request').mockImplementation((m, p) => m === 'eth_getBlockByNumber' ? Promise.resolve({ ...header, hash: changed, timestamp: '0x425' }) : request(m, p))
    await f.keeper.runOnce()
    expect(f.repo.read().spentWei).toBe('0'); expect(f.repo.read().reservedWei).toBe(String(BigInt(cancel.maxCostWei) + BigInt(f.original.maxCostWei)))
    expect(f.sign).toHaveBeenCalledTimes(2); expect(f.rpc.sent).toHaveLength(2)
    f.rpc.receipts.set(f.original.hash, { ...receipt(f.original.hash), blockHash: changed, gasUsed: '0x61a8' })
    await f.keeper.runOnce()
    expect(f.repo.read().spentWei).toBe('25000'); expect(f.repo.read().reservedWei).toBe('0')
    expect(f.repo.read().executions[cancel.hash].status).toBe('replaced')
    expect(f.repo.read().executions[cancel.hash].actualCostWei).toBeUndefined()
  })
})
