// Read-only regression: extracts functions into a sandbox. Never imports the CLI.
// No provider, signer, process, filesystem writes, or transport is exposed to the sandbox.
import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const root = new URL('../../', import.meta.url).pathname
const v = createRequire(root + '/standalone/web/package.json')('viem')
const source = fs.readFileSync(root + '/scripts/sodadex/pool-v3-execution.mjs', 'utf8')
const plan = JSON.parse(fs.readFileSync(root + '/deployments/xlayer-196-fragments-test/pool-v3/rehearsal.json'))
const pool = {abi:v.parseAbi(['function addLiquidity(uint256,uint256,uint256,uint256) payable returns (uint256)'])}
const executeSource = source.slice(source.indexOf('async function execute('), source.indexOf('const mode=process.argv'))
const sendSource = source.slice(source.indexOf('async function send('), source.indexOf('async function execute('))
assert.ok(executeSource.startsWith('async function execute(') && sendSource.startsWith('async function send('))
const step = plan.rows[4]
const decoded = v.decodeFunctionData({ abi: pool.abi, data: step.data })
const makeState = () => ({ deploymentVerified: true, rows: Array.from({ length: 4 }, () => ({ status: 'success' })), pending: null })
const request = { method: 'eth_sendTransaction', params: [{ from: plan.owner, to: plan.pool, chainId: '0xc4', value: step.value, data: step.data }] }
let passes = 0
function sandbox(state) {
  const counters = { sends: 0, rpc: 0 }
  const fail = () => { throw Error('Unexpected dependency access') }
  const context = vm.createContext({
    binding: async () => {}, load: () => state, plan, owner: plan.owner,
    v, artifacts: { SodaPool: pool }, same: (a, b) => a.toLowerCase() === b.toLowerCase(),
    runtime: async () => plan.runtimeHashes.pool,
    p: { getBlock: async () => ({ timestamp: decoded.args.at(-1) - 60n }) },
    read: async(_address,_artifact,method)=>({totalSupply:1000000000000000000n,reserveShares:1000000000000000000000n,reserveOkb:300000000000n})[method]??fail(), save: fail,
    send: async () => { counters.sends++; return { transactionHash: 'MOCK_NO_BROADCAST' } }, request,
  })
  vm.runInContext(executeSource, context)
  return { context, counters }
}
for (const kind of ['reverted', 'pending', 'missing-status']) {
  const state = makeState()
  if (kind === 'pending') state.pending = { hash: 'MOCK' }
  else if (kind === 'missing-status') delete state.rows[3].status
  else state.rows[3].status = 'reverted'
  const { context, counters } = sandbox(state)
  await assert.rejects(vm.runInContext("execute('wallet', request)", context), /Stage stopped/)
  assert.equal(counters.sends, 0)
  passes++
}
{
  const { context, counters } = sandbox(makeState())
  assert.equal(await vm.runInContext("execute('wallet', request)", context), 'MOCK_NO_BROADCAST')
  assert.equal(counters.sends, 1)
  passes++
}
{
  const state = makeState(); state.rows = Array.from({ length: 8 }, () => ({ status: 'success' })); state.rows[7].status = 'reverted'
  const { context, counters } = sandbox(state)
  await assert.rejects(vm.runInContext("execute('lock')", context), /Stage stopped/)
  assert.equal(counters.sends, 0)
  assert.notEqual(state.completed, true)
  passes++
}
// Test the inner send guard separately, independent of execute's outer guard.
for (const kind of ['reverted', 'pending', 'success']) {
  const state = makeState(); let reads = 0
  if (kind === 'pending') state.pending = { hash: 'MOCK' }
  if (kind === 'reverted') state.rows[3].status = 'reverted'
  const context = vm.createContext({ state, plan, owner: plan.owner, p: { getTransactionCount: async () => { reads++; throw Error('MOCK_PREFLIGHT_REACHED_NO_RPC') } } })
  vm.runInContext(sendSource, context)
  await assert.rejects(vm.runInContext('send(state, {})', context), kind === 'success' ? /MOCK_PREFLIGHT_REACHED_NO_RPC/ : /no replay/)
  assert.equal(reads, kind === 'success' ? 1 : 0)
  passes++
}
console.log(JSON.stringify({ passed: passes, failed: 0, evidence: 'Pure in-memory extracted-function regression; no actual RPC, signing, broadcasting, or product writes.' }))
