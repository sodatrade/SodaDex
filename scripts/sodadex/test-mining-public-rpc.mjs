import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { MINING_PUBLIC_RPC, VerifiedMiningRpc } from './mining-public-rpc.mjs'
import { LoopbackMiningPlan } from './mining-plan-rpc.mjs'

const owner = '0x6ecf746b078d46391f8C425B150153212F7C0545'
function result(request) {
  const pending = request.params.includes('pending')
  if (request.method === 'eth_chainId') return '0x7a0'
  if (request.method === 'eth_getBlockByNumber') return { number: pending ? '0x1001' : '0x1000', timestamp: pending ? '0x2001' : '0x2000' }
  if (request.method === 'eth_getTransactionCount') return '0x10'
  if (request.method === 'eth_getCode') return '0x6000'
  if (request.method === 'eth_estimateGas') return '0x100000'
  if (request.method === 'eth_getBalance') return '0xffff'
  if (request.method === 'eth_call') return '0x1234'
  throw new Error('Unexpected fixture method')
}
function transport(rewrite, attempts = 6) {
  let calls = 0
  const client = new VerifiedMiningRpc(owner, async (url, options) => {
    assert.equal(url, MINING_PUBLIC_RPC)
    const requests = JSON.parse(options.body); calls++
    assert.ok(Array.isArray(requests))
    const body = requests.map((r) => ({ jsonrpc: '2.0', id: r.id, result: result(r) }))
    rewrite?.(body, requests, calls)
    return new Response(JSON.stringify(body))
  }, attempts)
  return { client, calls: () => calls }
}
test('retry obsolete pending headers and return the fresh owner nonce', async () => {
  const t = transport((b, _, n) => { if (n < 3) { b[2].result = { number: '0x10', timestamp: '0x20' }; b[4].result = '0x0' } })
  assert.equal(await t.client.request('eth_getTransactionCount', [owner, 'pending']), '0x10')
  assert.equal(t.calls(), 3)
})
test('pending backend that never becomes fresh stops at the read retry bound', async () => {
  const t = transport((b) => { b[2].result = { number: '0x10', timestamp: '0x20' } })
  await assert.rejects(t.client.request('eth_getBlockByNumber', ['pending', false]), /stayed stale/)
  assert.equal(t.calls(), 6)
})
test('old nonce is retried but a real unconfirmed owner transaction blocks immediately', async () => {
  const old = transport((b, _, n) => { if (n === 1) b[4].result = '0x0' })
  assert.equal(await old.client.request('eth_getTransactionCount', [owner, 'pending']), '0x10')
  const pending = transport((b) => { b[4].result = '0x11' })
  await assert.rejects(pending.client.request('eth_getBalance', [owner, 'pending']), /unconfirmed transaction/)
  assert.equal(pending.calls(), 1)
})
test('estimates require the same target runtime in latest and pending state', async () => {
  const t = transport((b, _, n) => { if (n === 1) b[6].result = '0x' })
  assert.equal(await t.client.request('eth_estimateGas', [{ from: owner, to: owner, data: '0x1234' }, 'pending']), '0x100000')
  assert.equal(t.calls(), 2)
})
test('a zero balance from an inconsistent pending result is retried', async () => {
  const t = transport((b, _, n) => { if (n === 1) b.at(-1).result = '0x0' })
  assert.equal(await t.client.request('eth_getBalance', [owner, 'pending']), '0xffff')
  assert.equal(t.calls(), 2)
})
test('a real simulation error on a fresh snapshot is not retried', async () => {
  const t = transport((b) => { delete b.at(-1).result; b.at(-1).error = { code: -32000, message: 'revert' } })
  await assert.rejects(t.client.request('eth_call', [{ from: owner, to: owner }, 'pending']), /fresh snapshot/)
  assert.equal(t.calls(), 1)
})
test('unknown broadcast is attempted once and development methods remain rejected', async () => {
  let calls = 0
  const p = new VerifiedMiningRpc(owner, async () => { calls++; throw new Error('Unknown submission') })
  await assert.rejects(p.request('eth_sendRawTransaction', ['0x1234']), /Unknown submission/)
  assert.equal(calls, 1)
  await assert.rejects(p.request('evm_mine'), /non-reviewed/)
  assert.equal(calls, 1)
})
test('a wrong network or malformed batch never supplies a pending result', async () => {
  const wrong = transport((b) => { b[0].result = '0xc4' })
  await assert.rejects(wrong.client.request('eth_getBalance', [owner, 'pending']), /not chain1952/)
  const duplicate = transport((b) => { b[1].id = 0 })
  await assert.rejects(duplicate.client.request('eth_getBalance', [owner, 'pending']), /stayed stale/)
})
test('local budget continuation preserves proof and principal, and cannot relabel changed execution code', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'soda-local-resume-'))
  try {
    const p = new LoopbackMiningPlan(owner, path.join(folder, 'plan.json'), '1')
    p.executionSourceSha256 = { source: 'reviewed' }
    p.rpc = async (m) => m === 'eth_chainId' ? '0x7a0' : m === 'web3_clientVersion' ? 'anvil' : m === 'eth_getTransactionCount' ? '0x10' : undefined
    const saved = { localForkOnly: true, broadcast: false, chainId: 1952, owner, startNonce: '16', feeCap: '1',
      executionSourceSha256: { source: 'reviewed' }, contracts: {}, transactions: [], permit2Proof: { verified: true },
      businessPrincipal: { fabRaw: '123', nativeWei: '456' }, preBusinessSnapshot: '0x1' }
    await p.resume(saved)
    const persisted = JSON.parse(fs.readFileSync(p.output))
    assert.deepEqual(persisted.permit2Proof, saved.permit2Proof)
    assert.deepEqual(persisted.businessPrincipal, saved.businessPrincipal)
    assert.equal(persisted.preBusinessSnapshot, '0x1')
    await assert.rejects(p.resume({ ...saved, executionSourceSha256: { source: 'changed' } }), /execution sources must match/)
  } finally { fs.rmSync(folder, { recursive: true }) }
})
