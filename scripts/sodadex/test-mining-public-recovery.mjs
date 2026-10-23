import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getCreateAddress, keccak256 } from 'viem'
import { installFourCreateReuse, recoveringMiningRpc, validateFourCreateJournal, verifyFourCreateCheckpoint } from './mining-public-recovery.mjs'

const owner = '0x6ecf746b078d46391f8C425B150153212F7C0545'
const names = ['FabxRewardHistory', 'DewebRewardAccounting', 'DewebMiningExtension', 'PodMining']
function fixture() {
  const contracts = {}, rows = names.map((name, i) => {
    const data = `0x600${i}`, created = getCreateAddress({ from: owner, nonce: BigInt(16 + i) })
    contracts[name] = { address: created, runtimeKeccak256: keccak256('0x6000') }
    return { label: `Deploy ${name}`, nonce: String(16 + i), to: null, value: '0', created, data,
      dataKeccak256: keccak256(data), status: '0x1', costStatus: 'known', gas: '120', gasUsed: '100', feeWei: '200',
      hash: `0x${String(i + 1).repeat(64)}`, blockNumber: `0x${(100 + i).toString(16)}`, blockHash: `0x${String(i + 5).repeat(64)}` }
  })
  const journal = { chainId: 1952, publicTestnet: true, productionTouched: false, owner, startNonce: '16', feeCap: '2',
    pending: null, actualFeesWei: '800', transactions: structuredClone(rows), contracts: structuredClone(contracts) }
  const rehearsal = { localForkOnly: true, broadcast: false, chainId: 1952, owner, startNonce: '16', feeCap: '2', budgetPassed: true,
    business: { completed: true }, contracts, transactions: [...rows, ...Array.from({ length: 98 }, () => ({ gas: '120', status: '0x1' }))] }
  return { journal, rehearsal, policy: { chainId: 1952, phaseBudget: { gasWei: '25000' } } }
}
test('only the exact four confirmed creations can preserve the original cumulative fee reservation', () => {
  const { journal, rehearsal, policy } = fixture()
  const result = validateFourCreateJournal(journal, rehearsal, policy)
  assert.equal(result.actualFees, 800n); assert.equal(result.reservedPhaseWei, 24320n)
  assert.throws(() => validateFourCreateJournal(journal, rehearsal, { ...policy, phaseBudget: { gasWei: '24319' } }), /budget/)
  for (const mutate of [
    (j) => { j.pending = { hash: 'unresolved' } }, (j) => { j.transactions.pop() },
    (j) => { j.transactions.push(j.transactions[0]) }, (j) => { j.stack = {} },
    (j) => { j.transactions[0].nonce = '20' }, (j) => { j.transactions[0].created = owner },
    (j) => { j.transactions[0].value = '1' }, (j) => { j.transactions[0].to = owner },
    (j) => { j.transactions[0].dataKeccak256 = keccak256('0x6001') },
    (j) => { j.transactions[0].costStatus = 'unresolved' }, (j) => { j.actualFeesWei = '0' },
    (j) => { j.contracts.PodMining.runtimeKeccak256 = keccak256('0x') },
  ]) {
    const altered = structuredClone(journal); mutate(altered)
    assert.throws(() => validateFourCreateJournal(altered, rehearsal, policy))
  }
})
test('reuse sends none of the first four CREATEs and the first live action retains nonce20 and spent gas', async () => {
  const { journal, rehearsal } = fixture(), sends = []
  const plan = { rows: journal.transactions, actualFees: 800n,
    deploy: async (name) => { throw new Error(`Unexpected live deployment ${name}`) },
    send: async (label) => { sends.push({ label, nonce: 16 + plan.rows.length, actualFees: plan.actualFees }) } }
  const complete = installFourCreateReuse(plan, rehearsal, journal)
  await assert.rejects(plan.send('too early'), /before reusing/)
  for (const [i, name] of names.entries()) assert.equal(await plan.deploy(name, rehearsal.transactions[i].data), journal.transactions[i].created)
  assert.equal(complete(), true); assert.equal(plan.rows.length, 4)
  await plan.send('Upgrade empty 1952 mining history')
  assert.deepEqual(sends, [{ label: 'Upgrade empty 1952 mining history', nonce: 20, actualFees: 800n }])
  const p = { deploy: async () => {}, send: async () => {} }; installFourCreateReuse(p, rehearsal, journal)
  await assert.rejects(p.deploy(names[0], '0x6001'), /bytecode/)
  await assert.rejects(p.deploy(names[1], rehearsal.transactions[1].data), /order/)
})
function mockCheckpoint(journal, edit = () => {}) {
  return { checkFeeModel: async () => {}, rpc: async (method, params = []) => {
    if (method === 'eth_chainId') return '0x7a0'
    if (method === 'eth_getTransactionCount') return '0x14'
    if (method === 'eth_blockNumber') return '0x100'
    if (method === 'eth_getCode') return '0x6000'
    const row = journal.transactions.find((r) => method === 'eth_getTransactionReceipt' ? r.hash === params[0] : r.blockNumber === params[0])
    if (method === 'eth_getTransactionReceipt') {
      const receipt = { status: '0x1', from: owner, to: null, transactionHash: row.hash, contractAddress: row.created,
        blockNumber: row.blockNumber, blockHash: row.blockHash, gasUsed: '0x64', effectiveGasPrice: '0x2' }
      edit(receipt, 'receipt'); return receipt
    }
    if (method === 'eth_getBlockByNumber') {
      const tx = { hash: row.hash, from: owner, to: null, chainId: '0x7a0', nonce: `0x${Number(row.nonce).toString(16)}`,
        value: '0x0', gas: '0x78', gasPrice: '0x2', input: row.data }
      edit(tx, 'transaction'); return { hash: row.blockHash, transactions: [tx] }
    }
    throw new Error('Unexpected fixture RPC')
  } }
}
test('live checkpoint recomputes fees and verifies original chain transaction inputs, receipts and runtimes', async () => {
  const { journal, rehearsal, policy } = fixture()
  assert.equal((await verifyFourCreateCheckpoint(mockCheckpoint(journal), journal, rehearsal, policy)).actualFees, 800n)
  for (const [field, value, kind] of [['from', '0x0', 'receipt'], ['l1Fee', '0x1', 'receipt'], ['gasUsed', '0x65', 'receipt'],
    ['input', '0x6001', 'transaction'], ['nonce', '0x20', 'transaction'], ['chainId', '0xc4', 'transaction']])
    await assert.rejects(verifyFourCreateCheckpoint(mockCheckpoint(journal, (item, type) => { if (type === kind) item[field] = value }), journal, rehearsal, policy))
  const p = mockCheckpoint(journal), original = p.rpc
  p.rpc = async (method, params) => method === 'eth_getTransactionCount' ? '0x15' : original(method, params)
  await assert.rejects(verifyFourCreateCheckpoint(p, journal, rehearsal, policy), /nonce/)
})
function rpcBatch(options, stale = false, revert = false) {
  const operations = JSON.parse(String(options.body))
  return Response.json(operations.map((op, i) => {
    const result = op.method === 'eth_chainId' ? '0x7a0' : op.method === 'eth_getBlockByNumber'
      ? { number: op.params[0] === 'pending' && stale ? '0x1' : '0x20', timestamp: op.params[0] === 'pending' && stale ? '0x1' : '0x100' }
      : op.method === 'eth_getTransactionCount' ? op.params[1] === 'pending' && stale ? '0x0' : '0x14'
      : op.method === 'eth_getCode' ? '0x6000' : '0x1234'
    return { jsonrpc: '2.0', id: op.id, ...(revert && i === operations.length - 1 ? { error: { code: 3, message: 'execution reverted' } } : { result }) }
  }))
}
test('pending outages wait for fresh state inside a bounded read window; fresh reverts are never retried', async () => {
  let now = 0, calls = 0, waits = 0
  const rpc = recoveringMiningRpc(owner, { now: () => now, sleep: async (ms) => { now += ms; waits++ },
    fetcher: async (_, options) => rpcBatch(options, ++calls <= 6) })
  assert.equal(await rpc.request('eth_call', [{ to: owner, data: '0x' }, 'pending']), '0x1234')
  assert.equal(calls, 7); assert.equal(waits, 1)
  calls = 0
  const failed = recoveringMiningRpc(owner, { fetcher: async (_, options) => { calls++; return rpcBatch(options, false, true) } })
  await assert.rejects(failed.request('eth_call', [{ to: owner, data: '0x' }, 'pending']), /fresh snapshot/)
  assert.equal(calls, 1)
})
test('read retry window expires and uncertain broadcasts are sent exactly once', async () => {
  let now = 0, calls = 0
  const rpc = recoveringMiningRpc(owner, { windowMs: 4000, now: () => now, sleep: async (ms) => { now += ms },
    fetcher: async (_, options) => { calls++; return rpcBatch(options, true) } })
  await assert.rejects(rpc.request('eth_call', [{ to: owner, data: '0x' }, 'pending']), /stale/)
  assert.equal(now, 4000); assert.equal(calls, 12)
  calls = 0
  const send = recoveringMiningRpc(owner, { fetcher: async () => { calls++; throw new Error('fetch failed') } })
  await assert.rejects(send.request('eth_sendRawTransaction', ['0x1234']), /fetch failed/)
  assert.equal(calls, 1)
})
