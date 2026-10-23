// Exact approved ordinary V2 batch. Local keystore signs; no keys or signed bytes are saved.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createPublicClient, http, parseAbi, decodeFunctionData, encodeFunctionData, keccak256, type Hex, type Address } from 'viem'
import { V2, V2_ROUTER, V2_PAIR } from '../v2-protocol'
import { assertMiningFeeParameters } from '../../scripts/sodadex/mining-fee-model.mjs'
const root = process.cwd(), dir = path.join(root, 'deployments/xlayer-test/ordinary-v2')
const planBytes = fs.readFileSync(path.join(dir, 'rehearsal.json'))
const plan = JSON.parse(planBytes.toString()), approval = JSON.parse(fs.readFileSync(path.join(dir, 'approval.json'), 'utf8'))
const rpc = 'https://rpc.ignix.bot/rpc/196', client = createPublicClient({ transport: http(rpc, { timeout: 60000, retryCount: 1 }) })
const owner = plan.owner as Address, journalPath = path.join(dir, 'public-journal.json')
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
const json = (v: unknown): string => JSON.stringify(v, (_, value) => typeof value === 'bigint' ? String(value) : value, 2) + '\n'
const keys = path.join(os.homedir(), '.local/share/sodadex/wallets/xlayer-test-owner')
async function bindings(): Promise<void> {
  if (!approval.approved || approval.chainId !== 196 || approval.productionTouched !== false ||
    approval.totalCapWei !== '200000000000000' || approval.gasCapWei !== '199989900000000' ||
    approval.nonGasCapWei !== '10100000000' || approval.maxGasPriceWei !== '30000000' || approval.maxTransactions !== 27 ||
    approval.maxTestFabRaw !== '12100000000' || approval.maxTestV2Raw !== '11100000000' ||
    createHash('sha256').update(planBytes).digest('hex') !== approval.rehearsalSha256 || !same(approval.owner, owner)) throw Error('Exact approved plan required')
  if (await client.getChainId() !== 196 || plan.rows.length !== 27) throw Error('Wrong chain or batch')
  for (const [address, expected] of Object.entries(plan.runtimeHashes)) {
    const code = await client.getCode({ address: address as Address })
    if (!code || keccak256(code) !== expected) throw Error('TEST dependency runtime changed')
  }
  const signer = execFileSync('cast', ['wallet', 'address', '--keystore', keys + '/owner', '--password-file', keys + '/password'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (!same(signer, owner)) throw Error('Signer mismatch')
}
await bindings()
const resuming = process.argv[2] === 'resume'
const previous = resuming ? JSON.parse(fs.readFileSync(journalPath, 'utf8')) : undefined
if (fs.existsSync(journalPath) && !resuming) throw Error('Existing execution must be reconciled; never restart this batch')
if (previous && (previous.completed || previous.pending || previous.planSha256 !== approval.rehearsalSha256 ||
  previous.rows.some((row: { status: string }) => row.status !== 'success'))) throw Error('Unresolved or mismatched journal')
if (previous) {
  let charged = 0n, native = 0n
  for (const [index, row] of previous.rows.entries()) {
    const r = await client.getTransactionReceipt({ hash: row.hash }), tx = await client.getTransaction({ hash: row.hash }), step = plan.rows[index]
    if (r.status !== 'success' || !same(r.transactionHash, row.hash) || !same(r.from, owner) || tx.nonce !== plan.startNonce + index ||
      tx.value !== BigInt(step.value) || (step.to ? !same(tx.to ?? '', step.to) : tx.to !== null) ||
      (step.createdAddress && !same(r.contractAddress ?? '', step.createdAddress))) throw Error('Completed row reconciliation failed')
    charged += r.gasUsed * r.effectiveGasPrice; native += tx.value
  }
  if (charged !== BigInt(previous.gasSpentWei) || native !== BigInt(previous.grossNativeSpentWei)) throw Error('Journal cost mismatch')
}
const nonce = await client.getTransactionCount({ address: owner }), pending = await client.getTransactionCount({ address: owner, blockTag: 'pending' })
if (nonce !== plan.startNonce + (previous?.rows.length ?? 0) || pending !== nonce) throw Error('Final nonce changed; rehearse again')
if (await client.getBalance({ address: owner }) < BigInt(approval.totalCapWei)) throw Error('Insufficient approved budget balance')
for (const expected of plan.results.filter((result: { native: boolean }) => result.native)) {
  const balance = await client.readContract({ address: expected.pair, abi: V2_PAIR, functionName: 'balanceOf', args: [owner] })
  if (String(balance) !== expected.baselineLp) throw Error('Pre-existing LP baseline changed')
}
if (process.argv[2] === 'preflight') {
  console.log(json({ preflight: true, nonce, owner, chainId: 196, verifiedDependencies: Object.keys(plan.runtimeHashes).length })); process.exit(0)
}
if (process.argv[2] !== 'execute' && !resuming) throw Error('Use preflight, execute or explicitly reconciled resume')
fs.closeSync(fs.openSync(journalPath + '.lock', 'wx'))
const state = previous ?? { chainId: 196, owner, productionTouched: false, completed: false, startNonce: nonce,
  planSha256: approval.rehearsalSha256, rows: [] as Record<string, unknown>[], pending: null as Record<string, unknown> | null,
  gasSpentWei: '0', grossNativeSpentWei: '0', fabMaximumSpentRaw: '0', tokenMaximumSpentRaw: '0', results: [] as Record<string, unknown>[] }
const save = (): void => { fs.writeFileSync(journalPath + '.tmp', json(state)); fs.renameSync(journalPath + '.tmp', journalPath) }
save()
for (const step of plan.rows.slice(state.rows.length)) {
  const index = state.rows.length, expectedNonce = plan.startNonce + index
  if (index >= 27 || state.pending) throw Error('Stop: pending transaction or batch limit')
  let synchronized = false
  for (let attempt = 0; attempt < 8; attempt++) {
    const latest = await client.getTransactionCount({ address: owner }), queued = await client.getTransactionCount({ address: owner, blockTag: 'pending' })
    if (latest > expectedNonce || queued > expectedNonce) throw Error('Stop: nonce advanced unexpectedly')
    if (latest === expectedNonce && queued === expectedNonce) { synchronized = true; break }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  if (!synchronized) throw Error('Stop: node has not synchronized the confirmed nonce')
  const block = await client.getBlock(), value = BigInt(step.value), gas = BigInt(step.plannedGasLimit), gasPrice = await client.getGasPrice()
  let data = step.data as Hex
  if (step.to && same(step.to, V2.router)) {
    const decoded = decodeFunctionData({ abi: V2_ROUTER, data })
    if (decoded.functionName === 'removeLiquidity' || decoded.functionName === 'removeLiquidityETH') {
      const expected = plan.results.find((result: { native: boolean }) => result.native === (decoded.functionName === 'removeLiquidityETH'))
      const balance = await client.readContract({ address: expected.pair, abi: V2_PAIR, functionName: 'balanceOf', args: [owner] })
      const removable = balance - BigInt(expected.baselineLp)
      const liquidity = decoded.args[decoded.functionName === 'removeLiquidity' ? 2 : 1] as bigint
      if (removable < liquidity || (step.label.endsWith('remove-all-added') && removable !== liquidity)) throw Error('Stop before signing: removal would change the reviewed LP baseline')
    }
    const args = [...decoded.args]; args[args.length - 1] = block.timestamp + 900n
    data = encodeFunctionData({ abi: V2_ROUTER, functionName: decoded.functionName, args: args as never })
  }
  const newGas = BigInt(state.gasSpentWei) + gas * gasPrice, newNative = BigInt(state.grossNativeSpentWei) + value
  const newFab = BigInt(state.fabMaximumSpentRaw) + BigInt(step.maximumFabSpendRaw), newToken = BigInt(state.tokenMaximumSpentRaw) + BigInt(step.maximumTestTokenSpendRaw)
  if (gasPrice <= 0n || gasPrice > 30000000n || newGas > BigInt(approval.gasCapWei) || newNative > BigInt(approval.nonGasCapWei) ||
    newGas + newNative > BigInt(approval.totalCapWei) || newFab > BigInt(approval.maxTestFabRaw) || newToken > BigInt(approval.maxTestV2Raw)) throw Error('Approved budget stops before signing')
  await assertMiningFeeParameters({ call: (address: Address, signature: string, args: unknown[] = []) => client.readContract({ address,
    abi: parseAbi([signature]), functionName: signature.match(/function (\w+)/)![1], args }) }, BigInt(data.length / 2 + 200), gas)
  const tx = { account: owner, ...(step.to ? { to: step.to as Address } : {}), data, value }
  await client.call({ ...tx, gas })
  if (await client.estimateGas(tx) > gas) throw Error('Gas estimate exceeds rehearsed limit')
  let raw: Hex
  try {
    raw = execFileSync('cast', ['mktx', '--rpc-url', rpc, '--chain', '196', '--legacy', '--nonce', String(expectedNonce),
      '--gas-limit', String(gas), '--gas-price', String(gasPrice), '--value', String(value), '--keystore', keys + '/owner', '--password-file', keys + '/password',
      ...(step.to ? [step.to, data] : ['--create', data])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() as Hex
  } catch { throw Error('Local signing failed') }
  const hash = keccak256(raw)
  state.pending = { index, label: step.label, nonce: expectedNonce, hash, to: step.to, value: String(value), gas: String(gas), gasPrice: String(gasPrice) }; save()
  try { await client.request({ method: 'eth_sendRawTransaction', params: [raw] }, { retryCount: 0 }) }
  catch { throw Error('Broadcast uncertain: reconcile saved hash; never replay') }
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120000, pollingInterval: 1500, checkReplacement: false })
  if (!same(receipt.transactionHash, hash) || !same(receipt.from, owner) ||
    (step.to ? !same(receipt.to ?? '', step.to) : receipt.to !== null)) throw Error('Unexpected receipt: preserve pending and reconcile')
  const fee = receipt.gasUsed * receipt.effectiveGasPrice
  state.rows.push({ ...state.pending, status: receipt.status, feeWei: String(fee), blockNumber: String(receipt.blockNumber), createdAddress: receipt.contractAddress })
  state.pending = null; state.gasSpentWei = String(BigInt(state.gasSpentWei) + fee); state.grossNativeSpentWei = String(newNative)
  state.fabMaximumSpentRaw = String(newFab); state.tokenMaximumSpentRaw = String(newToken); save()
  if (receipt.status !== 'success' || (step.createdAddress && !same(receipt.contractAddress ?? '', step.createdAddress))) throw Error('Failed receipt or unexpected deployment: stop')
  console.log(json({ index, label: step.label, hash, gasSpentWei: state.gasSpentWei }))
}
for (const expected of plan.results) {
  const balance = await client.readContract({ address: expected.pair, abi: V2_PAIR, functionName: 'balanceOf', args: [owner] })
  if (String(balance) !== expected.baselineLp) throw Error('Pre-existing LP balance was not preserved')
  state.results.push({ ...expected, finalLp: String(balance) })
}
state.completed = true; save(); fs.unlinkSync(journalPath + '.lock')
console.log(json({ completed: true, transactions: state.rows.length, gasSpentWei: state.gasSpentWei, grossNativeSpentWei: state.grossNativeSpentWei }))
