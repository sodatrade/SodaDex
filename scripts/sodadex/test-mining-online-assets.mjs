import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { encodeFunctionData, parseAbi, toHex, keccak256 } from 'viem'
import { ONLINE_PHASE, ONLINE_OWNER, lpAmounts, assertOnlineIntent, json } from './mining-online-assets.mjs'
import { validateOnlineApproval, reconcileOnlineJournal } from './mining-online-assets-public.mjs'
import { OnlineLoopbackPlan, ONLINE_LOOPBACK } from './simulate-mining-online-assets.mjs'
import { sourceArtifact, fileSha } from './mining-plan-artifacts.mjs'
const artifactRoot = path.join(os.homedir(), 'Documents/SodaDex')
const keeper = '0x1111111111111111111111111111111111111111'
function approval() {
  const rehearsal = { phase: ONLINE_PHASE, chainId: 1952, localForkOnly: true, publicWrites: false, rehearsalPassed: true,
    owner: ONLINE_OWNER, startNonce: '118', feeCapWei: '20000001', result: { completed: true },
    draft: { keeper: null, keeperFundingWei: '0', listingPriceWei: '10000000000', lp: { nativeWei: '900', fabRaw: '900000000000' } },
    transactions: Array.from({ length: 13 }, (_, i) => ({ nonce: String(118 + i), gas: '21000', status: '0x1' })), totalFeeUpperBoundWei: String(13n * 21000n * 20000001n) }
  const bytes = Buffer.from(json(rehearsal)), sha = fileSha(bytes)
  const policy = { phase: ONLINE_PHASE, chainId: 1952, stage: 'test', approved: true, approvalReference: 'new explicit online test approval',
    keyRole: 'local-1952-test-owner', owner: ONLINE_OWNER, expectedOwnerNonce: '118', planSha256: sha,
    gasCapWei: rehearsal.totalFeeUpperBoundWei, liquidityNativeWei: '900', liquidityFabRaw: '900000000000', keeper: null, keeperFundingWei: '0', nftCount: 2, listingPriceWei: '10000000000' }
  const delivery = { phase: ONLINE_PHASE, planSha256: sha, policySha256: fileSha(json(policy)) }
  return { rehearsal, bytes, policy, delivery }
}
test('LP ratio uses exact FAB, native ceiling and reserve-quote floor; rejects zero reserves', () => {
  assert.deepEqual(lpAmounts(900000000000n, 100010031094n, 99990000000000n), { fabRaw: '900000000000', nativeWei: '899819738236227', minimumFabRaw: '900000000000', minimumNativeWei: '899819738236226' })
  assert.throws(() => lpAmounts(1n, 0n, 1n)); assert.throws(() => lpAmounts(-1n, 1n, 1n))
})
test('new phase approves only exact passing plan and explicit independent caps/key role', () => {
  const f = approval(); assert.doesNotThrow(() => validateOnlineApproval(f.rehearsal, f.bytes, f.policy, f.delivery))
  for (const change of [{ approved: false }, { phase: 'mining-products-1952' }, { chainId: 196 }, { expectedOwnerNonce: '16' },
    { keyRole: 'authorizer' }, { gasCapWei: '1' }, { keeperFundingWei: '1' }, { liquidityFabRaw: '1' }, { planSha256: 'changed' }, { nftCount: 3 }]) {
    const policy = { ...f.policy, ...change }, delivery = { ...f.delivery, policySha256: fileSha(json(policy)) }
    assert.throws(() => validateOnlineApproval(f.rehearsal, f.bytes, policy, delivery))
  }
  assert.throws(() => validateOnlineApproval({ ...f.rehearsal, rehearsalPassed: false }, f.bytes, f.policy, f.delivery))
  assert.throws(() => validateOnlineApproval(f.rehearsal, Buffer.from('modified'), f.policy, f.delivery))
})
test('nonce gaps and forged gas summary cannot pass even with a matching approved file hash', () => {
  for (const mutate of [p => { p.transactions[3].nonce = '99' }, p => { p.totalFeeUpperBoundWei = '1' }]) {
    const f = approval(); mutate(f.rehearsal); f.bytes = Buffer.from(json(f.rehearsal)); f.policy.planSha256 = fileSha(f.bytes)
    f.delivery.planSha256 = fileSha(f.bytes); f.delivery.policySha256 = fileSha(json(f.policy))
    assert.throws(() => validateOnlineApproval(f.rehearsal, f.bytes, f.policy, f.delivery))
  }
})
test('loopback transport can only contact owned 8955 and rejects a wrong chain', async () => {
  const calls = [], fetcher = async (url, init) => { const r = JSON.parse(init.body); calls.push(url); return Response.json({ jsonrpc: '2.0', id: r.id, result: r.method === 'eth_chainId' ? '0xc4' : null }) }
  const p = new OnlineLoopbackPlan('/tmp/no-write-online-assets.json', 1n, fetcher)
  await assert.rejects(() => p.start(), /Owned 1952 Anvil/)
  assert.deepEqual(calls, [ONLINE_LOOPBACK])
  assert.equal(await p.rpc('eth_chainId', []), '0xc4'); assert.ok(calls.every(url => url === ONLINE_LOOPBACK))
})
test('static target, value, approval spender and arbitrary data cannot diverge', async () => {
  const row = { to: ONLINE_OWNER, data: '0x12345678', value: '0' }
  await assert.rejects(() => assertOnlineIntent({}, row, keeper, row.data, 0n, {}, artifactRoot), /target/)
  await assert.rejects(() => assertOnlineIntent({}, row, row.to, row.data, 1n, {}, artifactRoot), /value/)
  await assert.rejects(() => assertOnlineIntent({}, row, row.to, '0xdeadbeef', 0n, {}, artifactRoot))
})
test('LP permits only a <=600-second fresh deadline; fixed amounts and receiver stay frozen', async () => {
  const abi = parseAbi(['function addLiquidityETH(address,uint256,uint256,uint256,address,uint256) payable returns(uint256,uint256,uint256)'])
  const encode = args => encodeFunctionData({ abi, functionName: 'addLiquidityETH', args })
  const args = [ONLINE_OWNER, 900n, 900n, 9n, ONLINE_OWNER, 1600n]
  const row = { to: ONLINE_OWNER, data: encode(args), value: '9' }, p = { rpc: async () => ({ timestamp: toHex(1000n) }) }
  await assertOnlineIntent(p, row, row.to, encode([...args.slice(0, 5), 1500n]), 9n, {}, artifactRoot)
  for (const deadline of [1000n, 1601n]) await assert.rejects(() => assertOnlineIntent(p, row, row.to, encode([...args.slice(0, 5), deadline]), 9n, {}, artifactRoot), /deadline/)
  const changed = [...args]; changed[4] = keeper
  await assert.rejects(() => assertOnlineIntent(p, row, row.to, encode(changed), 9n, {}, artifactRoot), /Fixed/)
})
test('NOT start accepts real armed anchor samples only; rejects fake proof, stale anchor and a changed task', async () => {
  const { notSamples } = await import('./mining-plan-nfts.mjs')
  const abi = sourceArtifact(artifactRoot, 'PodMining').value.abi, anchorHash = keccak256('0x1234')
  const proof = notSamples(anchorHash, ONLINE_OWNER, 6n, 2)
  const args = [ONLINE_OWNER, 6n, 1, 50n, proof.inputs, proof.outputs, proof.proofs, `0x${'0'.repeat(64)}`]
  const encode = a => encodeFunctionData({ abi, functionName: 'start', args: a })
  const row = { to: ONLINE_OWNER, data: encode(args), value: '0' }
  const plan = { call: async () => 50n, rpc: async method => method === 'eth_blockNumber' ? '0x33' : { hash: anchorHash } }
  await assertOnlineIntent(plan, row, row.to, row.data, 0n, { sampleCount: 2 }, artifactRoot)
  const bad = [...args]; bad[2] = 2
  await assert.rejects(() => assertOnlineIntent(plan, row, row.to, encode(bad), 0n, { sampleCount: 2 }, artifactRoot), /Fixed/)
  const badProof = [...args]; badProof[4] = ['0x01', '0x01']
  await assert.rejects(() => assertOnlineIntent(plan, row, row.to, encode(badProof), 0n, { sampleCount: 2 }, artifactRoot), /proof/)
  await assert.rejects(() => assertOnlineIntent({ ...plan, rpc: async () => '0x100' }, row, row.to, row.data, 0n, { sampleCount: 2 }, artifactRoot), /anchor/)
})
test('unknown public hash reconciliation never sends, re-signs, or releases its reservation', async () => {
  const methods = [], plan = { pending: { hash: keccak256('0x1234') }, rows: [], rpc: async method => { methods.push(method); return null }, finish: async () => { throw new Error('must not settle unknown') } }
  const result = await reconcileOnlineJournal(plan)
  assert.equal(result.reason, 'unknown_keep_full_reservation'); assert.deepEqual(methods, ['eth_getTransactionReceipt'])
  assert.ok(plan.pending)
})
test('a later gas price rise blocks new writes but cannot block canonical historical receipt reconciliation', async () => {
  const { PublicOnlineAssets } = await import('./mining-online-assets-public.mjs')
  const { privateKeyToAccount } = await import('viem/accounts')
  const account = privateKeyToAccount(`0x${'11'.repeat(32)}`) // Public dummy fixture only.
  const row = { label: 'gas funding fixture', nonce: '118', to: keeper, data: '0x', value: '1', gas: '21000' }
  const raw = await account.signTransaction({ chainId: 1952, type: 'legacy', nonce: 118, to: keeper, data: '0x', value: 1n, gas: 21000n, gasPrice: 1n })
  const hash = keccak256(raw), blockHash = keccak256('0x5678')
  const receipt = { transactionHash: hash, from: account.address, to: keeper, gasUsed: '0x5208', effectiveGasPrice: '0x1', blockNumber: '0x65', blockHash, status: '0x1' }
  const methods = [], historicalTags = []
  const transport = { request: async method => {
    methods.push(method)
    if (method === 'eth_gasPrice') return '0x2'
    if (method === 'eth_blockNumber') return '0x66'
    if (method === 'eth_getBlockByNumber') return { number: '0x65', hash: blockHash }
    if (method === 'eth_getTransactionReceipt') return receipt
    throw new Error(`Unexpected reconciliation method ${method}`)
  } }
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sodadex-assets-cost-'))
  const runner = new PublicOnlineAssets({ root: folder, artifactRoot, output: path.join(folder, 'journal.json'),
    rehearsal: { startNonce: '118', feeCapWei: '1', transactions: [row] }, bytes: Buffer.from('fixture'),
    policy: { gasCapWei: '21000' }, delivery: {}, transport,
    signer: async () => { throw new Error('Reconciliation must never sign') } })
  runner.owner = account.address; runner.owned = true; runner.pending = { ...row, raw, hash, submission: 'unknown' }
  runner.call = async (_to, signature, _args, tag) => {
    historicalTags.push(tag)
    return signature.includes('returns(bool)') ? true : 0n
  }
  try {
    await assert.rejects(() => runner.checkFees(1n, 21000n), /Gas price exceeds frozen cap/)
    const result = await reconcileOnlineJournal(runner)
    assert.equal(result.pending, false); assert.equal(result.status, '0x1')
    assert.equal(runner.actualFees, 21000n); assert.equal(runner.pending, undefined)
    assert.equal(runner.rows.length, 1); assert.equal(runner.rows[0].feeWei, '21000')
    assert.deepEqual(historicalTags, Array(6).fill('0x65'))
    assert.equal(methods.filter(method => method === 'eth_gasPrice').length, 1)
    assert.ok(!methods.includes('eth_sendRawTransaction'))
    assert.equal(JSON.parse(fs.readFileSync(runner.output)).reservedGasWei, '0')
  } finally { fs.rmSync(folder, { recursive: true, force: true }) }
})
test('lost public response persists original signed hash before one broadcast; restart reconciles without signing', async () => {
  const { PublicOnlineAssets } = await import('./mining-online-assets-public.mjs')
  const { privateKeyToAccount } = await import('viem/accounts')
  const account = privateKeyToAccount(`0x${'11'.repeat(32)}`) // Public dummy fixture only, never a real wallet.
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sodadex-assets-test-')), output = path.join(folder, 'journal.json')
  const row = { label: 'gas funding fixture', nonce: '118', to: keeper, data: '0x', value: '1', gas: '21000', status: '0x1' }
  const rehearsal = { startNonce: '118', feeCapWei: '1', draft: {}, transactions: [row] }
  let sends = 0, signatures = 0
  const methods = []
  const transport = { async request(method) {
    methods.push(method)
    if (method === 'eth_getTransactionCount') return '0x76'
    if (method === 'eth_call') return '0x'
    if (method === 'eth_estimateGas') return '0x5208'
    if (method === 'eth_sendRawTransaction') {
      sends++
      const saved = JSON.parse(fs.readFileSync(output))
      assert.equal(saved.pending.hash, keccak256(saved.pending.raw)); assert.equal(saved.pending.submission, 'unknown')
      assert.equal(saved.reservedGasWei, '21000')
      throw new Error('response lost')
    }
    if (method === 'eth_getTransactionReceipt') return null
    throw new Error(`Unexpected fixture method ${method}`)
  } }
  const runner = new PublicOnlineAssets({ root: folder, artifactRoot, output, rehearsal, bytes: Buffer.from('fixture'), policy: { gasCapWei: '21000' }, delivery: {}, transport,
    rootVerifier: async () => {}, signer: async tx => { signatures++; return account.signTransaction({ ...tx, type: 'legacy', chainId: 1952, gasPrice: 1n, nonce: Number(tx.nonce) }) } })
  runner.owner = account.address; runner.owned = true; runner.checkFees = async () => {}
  try {
    await assert.rejects(() => runner.send(row.label, row.to, row.data, 1n), /response lost/)
    assert.equal(sends, 1); assert.equal(signatures, 1)
    const pending = runner.pending
    await assert.rejects(() => runner.send(row.label, row.to, row.data, 1n), /unresolved/)
    assert.equal(sends, 1); assert.equal(signatures, 1)
    const saved = JSON.parse(fs.readFileSync(output))
    const restarted = new PublicOnlineAssets({ root: folder, artifactRoot, output, rehearsal, bytes: Buffer.from('fixture'), policy: { gasCapWei: '21000' }, delivery: {}, transport, signer: async () => { throw new Error('No new signature on restart') } })
    restarted.pending = saved.pending; restarted.rows = saved.transactions; restarted.actualFees = BigInt(saved.actualFeesWei)
    const result = await reconcileOnlineJournal(restarted)
    assert.equal(result.reason, 'unknown_keep_full_reservation'); assert.deepEqual(restarted.pending, pending)
    assert.equal(methods.filter(method => method === 'eth_sendRawTransaction').length, 1)
  } finally { fs.rmSync(folder, { recursive: true, force: true }) }
})
test('public CLI defaults to dry-run without any policy file, keystore program or network execution', async () => {
  const { execFileSync } = await import('node:child_process')
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sodadex-assets-cli-')), file = path.join(folder, 'draft.json')
  const f = approval(); fs.writeFileSync(file, json(f.rehearsal))
  try {
    const output = execFileSync(process.execPath, [new URL('./execute-mining-online-assets.mjs', import.meta.url).pathname, '--plan', file],
      { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } })
    const result = JSON.parse(output)
    assert.equal(result.publicExecution, false); assert.equal(result.signing, false); assert.equal(result.newApprovalRequired, true)
  } finally { fs.rmSync(folder, { recursive: true, force: true }) }
})
test('advanced or non-Anvil loopback nodes are rejected before any impersonation or write', async () => {
  for (const advanced of [false, true]) {
    const methods = [], fetcher = async (_url, init) => {
      const r = JSON.parse(init.body); methods.push(r.method)
      const result = { eth_chainId: '0x7a0', web3_clientVersion: advanced ? 'anvil/v1' : 'other/client',
        anvil_nodeInfo: { forkConfig: { forkBlockNumber: '0x7' } }, eth_blockNumber: '0x8' }[r.method]
      return Response.json({ jsonrpc: '2.0', id: r.id, result })
    }
    await assert.rejects(() => new OnlineLoopbackPlan('/tmp/never-write-online-assets.json', 1n, fetcher).start())
    assert.ok(!methods.some(method => method.startsWith('anvil_impersonate') || method.startsWith('eth_send')))
  }
})
test('new public read window waits through stale pending state but never retries a raw send or fresh revert', async () => {
  const { OnlineAssetRpc } = await import('./mining-online-assets-public.mjs')
  let now = 0, calls = 0
  const fetcher = async (_url, init) => {
    calls++
    const q = JSON.parse(init.body)
    if (!Array.isArray(q)) throw new Error('lost send response')
    const stale = calls === 1
    const replies = q.map(({ id, method, params }) => ({ jsonrpc: '2.0', id, result: method === 'eth_chainId' ? '0x7a0' :
      method === 'eth_getBlockByNumber' ? { number: stale && params[0] === 'pending' ? '0x1' : '0x64', timestamp: '0x400' } : '0x76' }))
    return Response.json(replies)
  }
  const rpc = new OnlineAssetRpc(ONLINE_OWNER, fetcher, { now: () => now, wait: async ms => { now += ms }, windowMs: 4000 })
  assert.equal(await rpc.request('eth_getTransactionCount', [ONLINE_OWNER, 'pending']), '0x76')
  assert.equal(calls, 2); assert.equal(now, 2000)
  await assert.rejects(() => rpc.request('eth_sendRawTransaction', ['0x1234']), /lost send response/)
  assert.equal(calls, 3)
  let freshCalls = 0
  const fresh = new OnlineAssetRpc(ONLINE_OWNER, async (_url, init) => {
    freshCalls++
    const q = JSON.parse(init.body)
    return Response.json(q.map(({ id, method }) => method === 'eth_call' ? { jsonrpc: '2.0', id, error: { code: 3, message: 'revert' } } :
      { jsonrpc: '2.0', id, result: method === 'eth_chainId' ? '0x7a0' : method === 'eth_getBlockByNumber' ? { number: '0x64', timestamp: '0x400' } : method === 'eth_getCode' ? '0x6000' : '0x76' }))
  }, { wait: async () => { throw new Error('A fresh revert must not retry') } })
  await assert.rejects(() => fresh.request('eth_call', [{ from: ONLINE_OWNER, to: keeper, data: '0x1234' }, 'pending']), /fresh snapshot/)
  assert.equal(freshCalls, 1)
})
test('owned fork retries upstream TLS/storage reads only; sends and genuine EVM reverts get one attempt', async () => {
  let calls = 0
  const retry = new OnlineLoopbackPlan('/tmp/never-write-online-assets.json', 1n, async () => {
    calls++
    return Response.json(calls === 1 ? { jsonrpc: '2.0', id: 1952, error: { code: -32603, message: 'failed to get storage: TLS peer closed connection' } } : { jsonrpc: '2.0', id: 1952, result: '0x1' })
  }, async () => {})
  assert.equal(await retry.rpc('eth_call', []), '0x1'); assert.equal(calls, 2)
  for (const [method, message] of [['eth_sendTransaction', 'TLS closed connection'], ['eth_call', 'execution reverted: connection']]) {
    let count = 0
    const plan = new OnlineLoopbackPlan('/tmp/never-write-online-assets.json', 1n, async () => {
      count++; return Response.json({ jsonrpc: '2.0', id: 1952, error: { code: -32603, message } })
    }, async () => {})
    await assert.rejects(() => plan.rpc(method, [])); assert.equal(count, 1)
  }
})
