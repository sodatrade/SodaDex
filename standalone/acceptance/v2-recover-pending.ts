// One explicitly approved recovery of the original nonce 198 transaction, never a replacement.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createPublicClient, http, keccak256, parseAbi, type Address, type Hex } from 'viem'
import { assertMiningFeeParameters } from '../../scripts/sodadex/mining-fee-model.mjs'
const dir = path.resolve('deployments/xlayer-test/ordinary-v2')
const file = path.join(dir, 'public-journal.json'), bytes = fs.readFileSync(file)
const state = JSON.parse(bytes.toString()), pending = state.pending
const planBytes = fs.readFileSync(path.join(dir, 'rehearsal.json')), plan = JSON.parse(planBytes.toString())
const approval = JSON.parse(fs.readFileSync(path.join(dir, 'approval.json'), 'utf8'))
const recovery = JSON.parse(fs.readFileSync(path.join(dir, 'recovery-approval.json'), 'utf8'))
const expected = '0x2ba4bd0775e597ab9bf9887b890fedbd64331cd3e1f65bae9c25aeacce1a46f0' as Hex
const rpc = 'https://rpc.ignix.bot/rpc/196', client = createPublicClient({ transport: http(rpc, { retryCount: 0 }) })
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
const json = (v: unknown): string => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x, 2) + '\n'
if (!recovery.approved || !recovery.sameSignedTransactionOnly || recovery.hash !== expected || recovery.nonce !== 198 ||
  !pending || pending.hash !== expected || pending.index !== 5 || pending.nonce !== 198 || state.rows.length !== 5 || state.completed ||
  createHash('sha256').update(planBytes).digest('hex') !== approval.rehearsalSha256 || state.planSha256 !== approval.rehearsalSha256 ||
  approval.totalCapWei !== recovery.totalCapWei || recovery.totalCapWei !== '200000000000000') throw Error('Exact pending recovery approval required')
const step = plan.rows[5], owner = state.owner as Address
if (!same(owner, plan.owner) || !same(owner, approval.owner) || step.value !== pending.value || !same(step.to, pending.to) ||
  step.plannedGasLimit !== pending.gas || BigInt(pending.gasPrice) > BigInt(approval.maxGasPriceWei) || await client.getChainId() !== 196) throw Error('Recovery binding mismatch')
for (const [address, runtimeHash] of Object.entries(plan.runtimeHashes)) {
  const code = await client.getCode({ address: address as Address })
  if (!code || keccak256(code) !== runtimeHash) throw Error('Dependency changed')
}
const gas = BigInt(pending.gas), gasPrice = BigInt(pending.gasPrice), value = BigInt(pending.value)
const maxGas = BigInt(state.gasSpentWei) + gas * gasPrice, native = BigInt(state.grossNativeSpentWei) + value
if (maxGas > BigInt(approval.gasCapWei) || native > BigInt(approval.nonGasCapWei) || maxGas + native > BigInt(approval.totalCapWei) ||
  BigInt(state.fabMaximumSpentRaw) + BigInt(step.maximumFabSpendRaw) > BigInt(approval.maxTestFabRaw) ||
  BigInt(state.tokenMaximumSpentRaw) + BigInt(step.maximumTestTokenSpendRaw) > BigInt(approval.maxTestV2Raw)) throw Error('Original budget exceeded')
const lock = file + '.recovery.lock'
fs.closeSync(fs.openSync(lock, 'wx'))
fs.writeFileSync(path.join(dir, 'public-journal-before-recovery.json'), bytes, { flag: 'wx' })
const result = await client.request({ method: 'eth_getTransactionReceipt', params: [expected] })
let rebroadcast = false
if (!result) {
  const found = await client.request({ method: 'eth_getTransactionByHash', params: [expected] })
  if (!found) {
    const latest = await client.getTransactionCount({ address: owner }), queued = await client.getTransactionCount({ address: owner, blockTag: 'pending' })
    if (latest !== 198 || queued !== 198) throw Error('Nonce changed; do not broadcast')
    await assertMiningFeeParameters({ call: (address: Address, signature: string, args: unknown[] = []) => client.readContract({ address,
      abi: parseAbi([signature]), functionName: signature.match(/function (\w+)/)![1], args }) }, BigInt(step.data.length / 2 + 200), gas)
    await client.call({ account: owner, to: step.to, data: step.data, value, gas })
    if (await client.estimateGas({ account: owner, to: step.to, data: step.data, value }) > gas) throw Error('Original gas limit insufficient')
    const keys = path.join(os.homedir(), '.local/share/sodadex/wallets/xlayer-test-owner')
    let raw: Hex
    try {
      raw = execFileSync('cast', ['mktx', '--rpc-url', rpc, '--chain', '196', '--legacy', '--nonce', '198',
        '--gas-limit', pending.gas, '--gas-price', pending.gasPrice, '--value', pending.value,
        '--keystore', keys + '/owner', '--password-file', keys + '/password', step.to, step.data],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() as Hex
    } catch { throw Error('Signing failed') }
    if (keccak256(raw) !== expected) throw Error('Signature hash differs; do not broadcast')
    try {
      const returned = await client.request({ method: 'eth_sendRawTransaction', params: [raw] }, { retryCount: 0 })
      if (returned !== expected) throw Error('Hash mismatch')
      rebroadcast = true
    } catch { throw Error('Same-hash broadcast uncertain; preserve original pending') }
  }
}
const receipt = await client.waitForTransactionReceipt({ hash: expected, timeout: 120000, pollingInterval: 1500, checkReplacement: false })
const tx = await client.getTransaction({ hash: expected })
if (receipt.transactionHash !== expected || !same(receipt.from, owner) || !same(receipt.to ?? '', step.to) || tx.nonce !== 198 ||
  tx.input !== step.data || tx.value !== value || tx.gas !== gas || tx.gasPrice !== gasPrice) throw Error('Receipt binding mismatch')
const fee = receipt.gasUsed * receipt.effectiveGasPrice
if (fee > gas * gasPrice) throw Error('Receipt fee exceeds signed transaction')
state.rows.push({ ...pending, status: receipt.status, feeWei: String(fee), blockNumber: String(receipt.blockNumber), createdAddress: receipt.contractAddress })
state.pending = null
state.gasSpentWei = String(BigInt(state.gasSpentWei) + fee)
state.grossNativeSpentWei = String(native)
state.fabMaximumSpentRaw = String(BigInt(state.fabMaximumSpentRaw) + BigInt(step.maximumFabSpendRaw))
state.tokenMaximumSpentRaw = String(BigInt(state.tokenMaximumSpentRaw) + BigInt(step.maximumTestTokenSpendRaw))
fs.writeFileSync(file + '.tmp', json(state)); fs.renameSync(file + '.tmp', file)
fs.writeFileSync(path.join(dir, 'recovery-result.json'), json({ hash: expected, rebroadcast, status: receipt.status, nonce: 198, feeWei: fee, preservedRows: 5, totalGasSpentWei: state.gasSpentWei }), { flag: 'wx' })
fs.unlinkSync(lock)
if (receipt.status !== 'success') throw Error('Original transaction failed; do not resume')
fs.unlinkSync(file + '.lock')
console.log(json({ recovered: true, hash: expected, rebroadcast, nextNonce: 199, gasSpentWei: state.gasSpentWei }))
