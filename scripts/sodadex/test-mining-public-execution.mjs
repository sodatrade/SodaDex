import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { privateKeyToAccount } from 'viem/accounts'
import { encodeFunctionData, keccak256, parseAbi } from 'viem'
import { miningFeeReservation, PublicMiningExecution, validateSignedMiningTransaction } from './mining-public-execution.mjs'
import { assertReviewedMiningIntent, miningExecutionSources } from './mining-reviewed-intent.mjs'
import { assertMiningFeeParameters } from './mining-fee-model.mjs'
import { LoopbackMiningPlan } from './mining-plan-rpc.mjs'

const owner = '0x6ecf746b078d46391f8C425B150153212F7C0545'
const to = '0x0000000000000000000000000000000000001952'
test('local fork retries transport failures only for reads, never writes or valid reverts', async () => {
  let calls = 0
  const transient = async () => { if (++calls === 1) throw new Error('transport timeout'); return Response.json({ jsonrpc: '2.0', id: 1, result: '0x10' }) }
  const p = new LoopbackMiningPlan(owner, '/tmp/unused-loopback-test', 1n, transient)
  assert.equal(await p.rpc('eth_blockNumber'), '0x10'); assert.equal(calls, 2)
  for (const method of ['eth_sendTransaction', 'evm_mine', 'evm_revert', 'evm_increaseTime']) {
    calls = 0
    await assert.rejects(p.rpc(method), /transport timeout/); assert.equal(calls, 1)
  }
  calls = 0
  p.fetcher = async () => { calls++; return Response.json({ jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted' } }) }
  await assert.rejects(p.rpc('eth_call'), /execution reverted/); assert.equal(calls, 1)
  calls = 0
  p.fetcher = async () => { calls++; throw new Error('transport timeout') }
  await assert.rejects(p.rpc('eth_getCode'), /transport timeout/); assert.equal(calls, 3)
})
test('fee checks bind OP parameters to L1Block and estimates to GasPriceOracle', async () => {
  const calls = [], oracle = '0x420000000000000000000000000000000000000f', l1Block = '0x4200000000000000000000000000000000000015'
  const p = { feeCap: 20n, rpc: async () => '0x14', call: async (target, signature, args = []) => {
    calls.push({ target, signature, args })
    if (signature.includes('operatorFeeScalar') || signature.includes('operatorFeeConstant')) {
      assert.equal(target, l1Block, 'operator parameters are L1Block getters')
      return signature.includes('uint32') ? 0 : 0n
    }
    assert.equal(target, oracle)
    return signature.includes('returns(bool)') ? true : 0n
  } }
  await assertMiningFeeParameters(p, 123n, 21000n)
  assert.equal(calls.length, 6)
  assert.deepEqual(calls.slice(-2).map((c) => c.args), [[123n], [21000n]])
  for (const changed of ['operatorFeeScalar', 'operatorFeeConstant', 'getOperatorFee', 'getL1FeeUpperBound', 'isFjord', 'isIsthmus']) {
    const altered = { ...p, call: async (target, signature, args) => signature.includes(changed)
      ? signature.includes('returns(bool)') ? false : 1n : p.call(target, signature, args) }
    await assert.rejects(assertMiningFeeParameters(altered, 123n, 21000n), /Fee model/)
  }
  await PublicMiningExecution.prototype.checkFeeModel.call(p, 123n, 21000n)
  await assert.rejects(PublicMiningExecution.prototype.checkFeeModel.call({ ...p, rpc: async () => '0x15' }, 123n, 21000n), /Gas price/)
})
test('signed transaction binds chain, signer, recipient, amount, calldata, nonce and gas', async () => {
  // Publicly known dummy key, unrelated to any deployed wallet.
  const account = privateKeyToAccount(`0x${'0'.repeat(63)}1`)
  const tx = { type: 'legacy', chainId: 1952, to, data: '0x1234', value: 10n, nonce: 16, gas: 30_000n, gasPrice: 20_000_001n }
  const raw = await account.signTransaction(tx), expected = { ...tx, from: account.address }
  assert.match(await validateSignedMiningTransaction(raw, expected), /^0x[0-9a-f]{64}$/)
  for (const altered of [{ from: owner }, { value: 11n }, { data: '0x1235' }, { gas: 30_001n }, { gasPrice: 1n }, { nonce: 17 }, { to: owner }])
    await assert.rejects(validateSignedMiningTransaction(raw, { ...expected, ...altered }))
  await assert.rejects(validateSignedMiningTransaction(await account.signTransaction({ ...tx, chainId: 196 }), expected))
})
test('fee reservation releases only confirmed unused gas and retains the remaining upper bounds', () => {
  const rows = [{ gas: '100' }, { gas: '200' }, { gas: '300' }]
  assert.equal(miningFeeReservation(rows, 1, 2n, 50n, 210n), 1070n)
  assert.equal(miningFeeReservation(rows, 2, 2n, 120n, 300n), 720n)
})
test('an existing public journal is rejected byte-for-byte without touching RPC or signing', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sodadex-journal-')), output = path.join(folder, 'journal.json')
  const bytes = '{"pending":{"hash":"retained"},"actualFees":"123"}\n'
  fs.writeFileSync(output, bytes)
  const rehearsal = { localForkOnly: true, broadcast: false, chainId: 1952, owner, startNonce: '16', feeCap: '1', totalFeeUpperBound: '1',
    budgetPassed: true, business: { completed: true } }
  const p = new PublicMiningExecution(owner, output, rehearsal, {}, { phaseBudget: { gasWei: '2' } })
  p.rpc = async () => { throw new Error('RPC must not be reached') }
  await assert.rejects(p.start(), /journal already exists/)
  assert.equal(p.journalOwned, false)
  assert.throws(() => p.save(), /does not own/)
  assert.equal(fs.readFileSync(output, 'utf8'), bytes)
  fs.rmSync(folder, { recursive: true })
})
test('static approval tampering is rejected before any wallet or public RPC action', async () => {
  const abi = parseAbi(['function approve(address,uint256) returns(bool)'])
  const reviewed = encodeFunctionData({ abi, functionName: 'approve', args: [to, 10n] })
  const root = path.resolve(import.meta.dirname, '../..')
  await assert.rejects(assertReviewedMiningIntent({ rpc: async () => { throw new Error('No RPC should be reached') } }, root,
    { data: reviewed, value: '0' }, to, encodeFunctionData({ abi, functionName: 'approve', args: [to, 11n] }), 0n), /Static calldata/)
})
test('two copies of one repository cannot satisfy the two-source publication gate', async () => {
  const root = path.resolve(import.meta.dirname, '../..')
  const rehearsal = { localForkOnly: true, broadcast: false, chainId: 1952, owner, startNonce: '16', feeCap: '1', totalFeeUpperBound: '1',
    budgetPassed: true, business: { completed: true }, executionSourceSha256: miningExecutionSources(root) }
  const p = new PublicMiningExecution(owner, path.join(os.tmpdir(), 'absent-sodadex-duplicate-journal'), rehearsal,
    { repositories: [{ path: root }, { path: root }] }, { phaseBudget: { gasWei: '2' } })
  p.rpc = async () => { throw new Error('RPC must not be reached') }
  await assert.rejects(p.start(), /distinct canonical/)
})
test('a new deadline is allowed while a changed LP amount or minimum is blocked', async () => {
  const root = path.resolve(import.meta.dirname, '../..'), abi = parseAbi(['function addLiquidity(uint256,uint256,uint256,uint256,uint256) returns(uint256)'])
  const reviewed = encodeFunctionData({ abi, functionName: 'addLiquidity', args: [100n, 10n, 99n, 9n, 100n] })
  const p = { rpc: async () => ({ timestamp: '0x100' }) }, row = { data: reviewed, value: '0' }
  await assertReviewedMiningIntent(p, root, row, to, encodeFunctionData({ abi, functionName: 'addLiquidity', args: [100n, 10n, 99n, 9n, 300n] }), 0n)
  await assert.rejects(assertReviewedMiningIntent(p, root, row, to, encodeFunctionData({ abi, functionName: 'addLiquidity', args: [101n, 10n, 99n, 9n, 300n] }), 0n), /Fixed arguments/)
  await assert.rejects(assertReviewedMiningIntent(p, root, row, to, encodeFunctionData({ abi, functionName: 'addLiquidity', args: [100n, 10n, 1n, 9n, 300n] }), 0n), /Fixed arguments/)
})

for (const unexpectedFee of [false, true]) test(`persist ${unexpectedFee ? 'unexpected extra fees' : 'a failed receipt'} before halting`, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sodadex-receipt-')), output = path.join(folder, 'journal.json')
  const account = privateKeyToAccount(`0x${'0'.repeat(63)}1`), data = '0x1234', hashBlock = `0x${'b'.repeat(64)}`
  const rehearsal = { feeCap: '1', transactions: [{ label: 'Fixture', to, data, gas: '25200', value: '0' }] }
  const p = new PublicMiningExecution(account.address, output, rehearsal, {}, { phaseBudget: { gasWei: '1000000' } })
  p.startNonce = 16n; p.journalOwned = true
  let submittedHash, submitted = 0
  p.signIntent = async (tx) => account.signTransaction({ ...tx, nonce: Number(tx.nonce), gasPrice: 1n, chainId: 1952, type: 'legacy' })
  p.checkFeeModel = async () => {}
  p.rpc = async (method, params) => {
    if (method === 'eth_getTransactionCount') return '0x10'
    if (method === 'eth_call') return '0x'
    if (method === 'eth_estimateGas') return '0x5208'
    if (method === 'eth_getBalance') return '0x1000000'
    if (method === 'eth_sendRawTransaction') { submitted++; submittedHash = keccak256(params[0]); return submittedHash }
    if (method === 'eth_getTransactionReceipt') return { transactionHash: submittedHash, blockNumber: '0x10', blockHash: hashBlock,
      from: account.address, to, status: unexpectedFee ? '0x1' : '0x0', gasUsed: '0x5208', effectiveGasPrice: '0x1', l1Fee: unexpectedFee ? '0x5' : '0x0' }
    if (method === 'eth_blockNumber') return '0x11'
    if (method === 'eth_getBlockByNumber') return { hash: hashBlock }
    throw new Error('Unexpected mock RPC')
  }
  await assert.rejects(p.send('Fixture', to, data), unexpectedFee ? /Fee model changed/ : /reverted/)
  const journal = JSON.parse(fs.readFileSync(output, 'utf8'))
  assert.equal(journal.transactions.length, 1)
  assert.equal(journal.actualFeesWei, unexpectedFee ? '21005' : '21000')
  assert.equal(journal.transactions[0].receipt.transactionHash, submittedHash)
  assert.equal(submitted, 1)
  assert.equal(!!journal.pending, unexpectedFee)
  fs.rmSync(folder, { recursive: true })
})
test('a failed complete budget cannot reach RPC, sign or broadcast', async () => {
  const p = new PublicMiningExecution(owner, '/tmp/unused-sodadex-journal', { feeCap: '1', budgetPassed: false }, {}, { phaseBudget: { gasWei: '2' } })
  p.rpc = async () => { throw new Error('RPC must not be reached') }
  await assert.rejects(p.start(), /complete passing/)
  assert.equal(p.journalOwned, false)
})
