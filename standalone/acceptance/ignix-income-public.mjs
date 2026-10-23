// One approved isolated TEST deployment. Public reads, finite local signing,
// write-ahead hashes, no broadcast retries and no raw signed bytes on disk.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { assertMiningFeeParameters } from '../../scripts/sodadex/mining-fee-model.mjs'
const require = createRequire(new URL('../web/package.json', import.meta.url))
const { createPublicClient, http, parseAbi, encodeFunctionData, decodeFunctionData, encodeDeployData, keccak256 } = require('viem')
const root = process.cwd(), dir = path.join(root, 'deployments/xlayer-196-fragments-test/ignix-income')
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v, 2) + '\n'
const load = file => JSON.parse(fs.readFileSync(path.join(dir, file)))
const digest = file => createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex')
const approval = load('approval.json'), proposed = load('rehearsal.json'), plan = load('final-rehearsal.json')
const owner = '0x6ecf746b078d46391f8C425B150153212F7C0545', treasury = '0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A'
const vault = '0xb97d23f0c874fc1380016fa31d975d7ccd13b94d', fab = '0x842b7bf61f2cb4be8aacac6adece3244c2a6f6ab'
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
const rpc = 'https://rpc.ignix.bot/rpc/196', c = createPublicClient({ transport: http(rpc, { retryCount: 0, timeout: 60000 }) })
const artifacts = name => JSON.parse(fs.readFileSync(path.resolve(root, `../../XTruthWorkspace/contract/out/${name}.sol/${name}.json`)))
const poolArtifact = artifacts('SodaIgnixPool'), lockerArtifact = artifacts('SodaLocker'), incomeArtifact = artifacts('IgnixTreasuryIncome')
const tokenAbi = parseAbi(['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)'])
async function retryRead(action) {
  for (let attempt = 0; ; attempt++) {
    try { return await action() } catch (error) {
      if (attempt >= 7) throw error
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
  }
}
const read = (address, abi, functionName, args = [], blockNumber) => retryRead(() => c.readContract({ address, abi, functionName, args, ...(blockNumber === undefined ? {} : { blockNumber }) }))
const file = path.join(dir, 'public-journal.json'), resuming = process.argv[2] === 'resume-confirmed'
const previous = resuming ? load('public-journal.json') : null
if (previous && (previous.completed || previous.pending || previous.planSha256 !== digest('final-rehearsal.json') || previous.approvalSha256 !== digest('approval.json') || previous.rows.some(row => row.status !== 'success'))) throw Error('Unresolved journal: cannot resume')
const keys = path.join(os.homedir(), '.local/share/sodadex/wallets/xlayer-test-owner')
const signer = execFileSync('cast', ['wallet', 'address', '--keystore', keys + '/owner', '--password-file', keys + '/password'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
if (!approval.approved || !same(signer, owner) || !same(approval.owner, owner) || !same(approval.treasury, treasury) || approval.productionTouched !== false ||
  approval.totalCapWei !== '390000000000000' || approval.gasCapWei !== '389966990000000' || approval.nonGasCapWei !== '33010000000' ||
  approval.maxSharesRaw !== '110010000000000000000' || approval.maxFabRaw !== '10000' || approval.maxTransactions !== 14 || approval.maxGasPriceWei !== '30000000' ||
  approval.proposalSha256 !== digest('budget-proposal.json') || load('budget-proposal.json').originalRehearsalSha256 !== digest('rehearsal.json')) throw Error('Exact approval required')
if (await c.getChainId() !== 196 || plan.chainId !== 196 || !plan.localOnly || !same(plan.owner, owner) || !same(plan.recipient, treasury) || plan.rows.length !== 14 || plan.nonce !== proposed.nonce) throw Error('Final rehearsal mismatch')
const normalize = row => {
  if (same(row.to, plan.pool)) {
    const d = decodeFunctionData({ abi: poolArtifact.abi, data: row.data })
    if (['addLiquidity', 'removeLiquidity', 'swap'].includes(d.functionName)) {
      const args = [...d.args]; args[args.length - 1] = 0n
      return encodeFunctionData({ abi: poolArtifact.abi, functionName: d.functionName, args })
    }
  }
  return row.data
}
for (const [i, row] of plan.rows.entries()) {
  const old = proposed.rows[i]
  if (row.label !== old.label || row.to !== old.to || row.value !== old.value || row.createdAddress !== old.createdAddress || normalize(row) !== normalize(old)) throw Error('Approved action changed')
}
if (encodeDeployData({ abi: poolArtifact.abi, bytecode: poolArtifact.bytecode.object, args: [vault, treasury] }) !== plan.rows[0].data ||
  encodeDeployData({ abi: lockerArtifact.abi, bytecode: lockerArtifact.bytecode.object, args: [plan.pool, owner] }) !== plan.rows[1].data) throw Error('Artifact or constructor changed')
const dependencyCode = await c.getCode({ address: vault })
if (!dependencyCode || keccak256(dependencyCode) !== '0x02dcd3b531133ba0ca0f53d2fc3641caab7e3fd5b08b2a9eb948674e725173e4') throw Error('TEST vault changed')
const oldIntegration = JSON.parse(fs.readFileSync(path.join(dir, '../integration.json')))
const oldPool = oldIntegration.contracts.SodaPool.address
const oldLp = await read(oldPool, tokenAbi, 'balanceOf', [owner])
if (previous) {
  let spent = 0n, native = 0n
  for (const [i, row] of previous.rows.entries()) {
    const receipt = await c.getTransactionReceipt({ hash: row.hash }), tx = await c.getTransaction({ hash: row.hash }), step = plan.rows[i]
    const canonical = await c.getBlock({ blockNumber: receipt.blockNumber })
    if (receipt.status !== 'success' || receipt.blockHash !== canonical.hash || !same(receipt.from, owner) || tx.nonce !== plan.nonce + i || tx.chainId !== 196 ||
      tx.value !== BigInt(step.value) || (step.to ? !same(tx.to, step.to) : tx.to !== null) || tx.gas !== BigInt(step.plannedGasLimit) || tx.gasPrice > 30000000n ||
      keccak256(tx.input) !== row.dataHash || normalize({ ...step, data: tx.input }) !== normalize(step) || step.createdAddress && !same(receipt.contractAddress, step.createdAddress)) throw Error('Receipt reconciliation failed')
    const rawReceipt = await c.request({ method: 'eth_getTransactionReceipt', params: [row.hash] })
    if (BigInt(rawReceipt.l1Fee ?? '0x0') !== 0n || BigInt(rawReceipt.operatorFee ?? '0x0') !== 0n) throw Error('Unexpected receipt fees')
    spent += receipt.gasUsed * receipt.effectiveGasPrice; native += tx.value
  }
  if (spent !== BigInt(previous.gasSpentWei) || native !== BigInt(previous.grossNativeSpentWei) || oldLp !== BigInt(previous.oldLpBefore)) throw Error('Existing ledger mismatch')
}
const nextNonce = plan.nonce + (previous?.rows.length ?? 0)
if (await c.getTransactionCount({ address: owner }) !== nextNonce || await c.getTransactionCount({ address: owner, blockTag: 'pending' }) !== nextNonce) throw Error('Nonce changed: rehearse before signing')
if (await c.getBalance({ address: owner }) < BigInt(approval.totalCapWei) || await read(vault, tokenAbi, 'balanceOf', [owner]) < BigInt(approval.maxSharesRaw) || await read(fab, tokenAbi, 'balanceOf', [owner]) < BigInt(approval.maxFabRaw)) throw Error('Insufficient TEST budget balance')
if (plan.rows.reduce((n, row) => n + BigInt(row.plannedGasLimit) * 30000000n, 0n) > BigInt(approval.gasCapWei)) throw Error('Final rehearsal gas ceiling exceeded')
const feeCheck = (data, gas) => assertMiningFeeParameters({ call: (address, signature, args = []) => read(address, parseAbi([signature]), signature.match(/function (\w+)/)[1], args) }, BigInt(data.length / 2 + 200), gas)
await feeCheck(plan.rows[0].data, BigInt(plan.rows[0].plannedGasLimit))
await c.call({ account: owner, data: plan.rows[0].data, gas: BigInt(plan.rows[0].plannedGasLimit) })
if (process.argv[2] === 'preflight') { console.log(json({ preflight: true, chainId: 196, owner, treasury, nonce: plan.nonce, transactions: 14, productionTouched: false })); process.exit(0) }
if (process.argv[2] !== 'execute' && !resuming) throw Error('Use preflight, execute or resume-confirmed')
if (fs.existsSync(file) && !resuming) throw Error('Existing batch: reconcile, never restart')
if (resuming) {
  fs.writeFileSync(path.join(dir, 'public-journal-before-read-recovery.json'), fs.readFileSync(file), { flag: 'wx' })
  fs.unlinkSync(file + '.lock')
}
fs.closeSync(fs.openSync(file + '.lock', 'wx'))
const state = previous ?? { chainId: 196, owner, treasury, productionTouched: false, publicDeployed: false, completed: false, startNonce: plan.nonce,
  planSha256: digest('final-rehearsal.json'), approvalSha256: digest('approval.json'), gasSpentWei: '0', grossNativeSpentWei: '0', rows: [], pending: null,
  pool: plan.pool, income: plan.income, rewards: plan.rewards, locker: plan.locker, oldPool, oldLpBefore: String(oldLp), results: {}, contracts: {} }
const save = () => { fs.writeFileSync(file + '.tmp', json(state)); fs.renameSync(file + '.tmp', file) }
save()
async function verifyIncome(blockNumber) {
  if (!same(await read(plan.pool, poolArtifact.abi, 'INCOME', [], blockNumber), plan.income) || !same(await read(plan.pool, poolArtifact.abi, 'REWARDS', [], blockNumber), plan.rewards) ||
    !same(await read(plan.income, incomeArtifact.abi, 'RECIPIENT', [], blockNumber), treasury) || !same(await read(plan.income, incomeArtifact.abi, 'POOL', [], blockNumber), plan.pool) ||
    !same(await read(plan.income, incomeArtifact.abi, 'FAB', [], blockNumber), fab)) throw Error('Immutable binding mismatch')
  state.publicDeployed = true; save()
}
if (previous?.rows.length) await verifyIncome(BigInt(previous.rows[0].blockNumber))
for (const step of plan.rows.slice(state.rows.length)) {
  const i = state.rows.length, nonce = plan.nonce + i, gas = BigInt(step.plannedGasLimit), value = BigInt(step.value)
  if (i >= 14 || state.pending) throw Error('Batch stopped')
  let synced = false
  for (let attempt = 0; attempt < 8; attempt++) {
    const latest = await c.getTransactionCount({ address: owner }), pending = await c.getTransactionCount({ address: owner, blockTag: 'pending' })
    if (latest > nonce || pending > nonce) throw Error('Unexpected nonce advancement')
    if (latest === nonce && pending === nonce) { synced = true; break }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!synced) throw Error('Nonce not synchronized')
  let data = step.data
  if (same(step.to, plan.pool)) {
    const d = decodeFunctionData({ abi: poolArtifact.abi, data })
    if (['addLiquidity', 'removeLiquidity', 'swap'].includes(d.functionName)) {
      const args = [...d.args]; args[args.length - 1] = (await c.getBlock()).timestamp + 900n
      data = encodeFunctionData({ abi: poolArtifact.abi, functionName: d.functionName, args })
    }
  }
  const gasPrice = await c.getGasPrice(), native = BigInt(state.grossNativeSpentWei) + value, worstGas = BigInt(state.gasSpentWei) + gas * gasPrice
  if (gasPrice <= 0n || gasPrice > 30000000n || worstGas > BigInt(approval.gasCapWei) || native > BigInt(approval.nonGasCapWei) || worstGas + native > BigInt(approval.totalCapWei)) throw Error('Budget stop before signing')
  await feeCheck(data, gas)
  const tx = { account: owner, data, value, gas, ...(step.to ? { to: step.to } : {}) }
  await retryRead(() => c.call(tx))
  if (await retryRead(() => c.estimateGas(tx)) > gas) throw Error('Gas exceeds approved rehearsal limit')
  let raw
  try { raw = execFileSync('cast', ['mktx', '--rpc-url', rpc, '--chain', '196', '--legacy', '--nonce', String(nonce), '--gas-limit', String(gas), '--gas-price', String(gasPrice), '--value', String(value), '--keystore', keys + '/owner', '--password-file', keys + '/password', ...(step.to ? [step.to, data] : ['--create', data])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  catch { throw Error('Local signing failed') }
  const hash = keccak256(raw)
  state.pending = { index: i, label: step.label, nonce, hash, to: step.to, value, gas, gasPrice, dataHash: keccak256(data) }; save()
  try { if (await c.request({ method: 'eth_sendRawTransaction', params: [raw] }, { retryCount: 0 }) !== hash) throw Error('Hash mismatch') }
  catch { throw Error('Broadcast uncertain: stop and reconcile saved hash, no replay') }
  const receipt = await c.waitForTransactionReceipt({ hash, timeout: 120000, pollingInterval: 1500, checkReplacement: false })
  const rawReceipt = await c.request({ method: 'eth_getTransactionReceipt', params: [hash] })
  if (!same(receipt.from, owner) || !same(receipt.transactionHash, hash) || (step.to ? !same(receipt.to, step.to) : receipt.to !== null)) throw Error('Unexpected receipt')
  const extra = BigInt(rawReceipt.l1Fee ?? '0x0') + BigInt(rawReceipt.operatorFee ?? '0x0')
  const fee = receipt.gasUsed * receipt.effectiveGasPrice + extra
  state.rows.push({ ...state.pending, status: receipt.status, feeWei: fee, gasUsed: receipt.gasUsed, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, createdAddress: receipt.contractAddress })
  state.pending = null; state.gasSpentWei = String(BigInt(state.gasSpentWei) + fee); state.grossNativeSpentWei = String(native); save()
  if (receipt.status !== 'success' || extra !== 0n || BigInt(state.gasSpentWei) + native > BigInt(approval.totalCapWei) || step.createdAddress && !same(receipt.contractAddress, step.createdAddress)) throw Error('Receipt failed or changed fee/deployment')
  if (i === 0) await verifyIncome(receipt.blockNumber)
  console.log(json({ index: i, label: step.label, hash, gasSpentWei: state.gasSpentWei }))
}
// Verify receipt-block recipient deltas, not balances mixed with later traffic.
for (const [label, native] of [['pay-platform-okb', true], ['pay-lp-fab', false]]) {
  const row = state.rows.find(row => row.label === label), b = BigInt(row.blockNumber)
  const before = native ? await c.getBalance({ address: treasury, blockNumber: b - 1n }) : await read(fab, tokenAbi, 'balanceOf', [treasury], b - 1n)
  const after = native ? await c.getBalance({ address: treasury, blockNumber: b }) : await read(fab, tokenAbi, 'balanceOf', [treasury], b)
  const owed = await read(plan.income, incomeArtifact.abi, native ? 'platformOkbOwed' : 'lpFabOwed', [], b - 1n)
  if (owed <= 0n || after - before !== owed || await read(plan.income, incomeArtifact.abi, native ? 'platformOkbOwed' : 'lpFabOwed', [], b) !== 0n) throw Error('Treasury payout mismatch')
  state.results[native ? 'treasuryOkbPaid' : 'treasuryFabPaid'] = String(owed)
}
const locked = await read(plan.locker, lockerArtifact.abi, 'locked'), lp = await read(plan.pool, tokenAbi, 'balanceOf', [owner])
if (lp !== 0n || locked !== BigInt(plan.remainingLpLocked) || await read(oldPool, tokenAbi, 'balanceOf', [owner]) !== oldLp) throw Error('LP preservation mismatch')
state.results.lockedLp = String(locked); state.results.ownerLp = String(lp); state.results.oldLpPreserved = true
const identities = { SodaIgnixPool: plan.pool, IgnixTreasuryIncome: plan.income, IgnixLpRewards: plan.rewards, SodaLocker: plan.locker,
  SodaVault: vault, SodaPolicy: oldIntegration.contracts.SodaPolicy.address }
for (const [name, address] of Object.entries(identities)) {
  const code = await c.getCode({ address }); if (!code || code === '0x') throw Error('Missing deployed runtime')
  state.contracts[name] = { address, runtimeHash: keccak256(code) }
}
state.completed = true; save(); fs.unlinkSync(file + '.lock')
console.log(json({ completed: true, transactions: state.rows.length, pool: plan.pool, income: plan.income, gasSpentWei: state.gasSpentWei, nativeInputWei: state.grossNativeSpentWei, results: state.results }))
