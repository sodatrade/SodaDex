#!/usr/bin/env node
// No public write API. Anvil is a child of this process and every RPC checks its PID.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { serializeTransaction, formatEther } from 'viem'
import { mining196LocalDeployment } from './mining-196-deployment.mjs'
import { summarize196Budget } from './mining-196-budget.mjs'
import { Mining196Plan } from './mining-196-plan.mjs'
import { load196Artifacts } from './mining-196-artifacts.mjs'
import { prepare196Stack } from './mining-196-stack.mjs'
import { prepareMiningNfts } from './mining-plan-nfts.mjs'
import { exerciseMiningProducts } from './mining-plan-business.mjs'
import { fileSha } from './mining-plan-artifacts.mjs'
import { persistentMining196Signer } from './mining-196-signer.mjs'

const { values } = parseArgs({ options: { 'source-root': { type: 'string' }, 'product-manifest': { type: 'string' },
  'persistent-signer': { type: 'boolean', default: false }, 'reuse-manifest': { type: 'string' }, output: { type: 'string' }, anvil: { type: 'string', default: 'anvil' } } })
for (const key of ['source-root', 'product-manifest', 'reuse-manifest', 'output']) if (!values[key]) throw new Error(`Required --${key}`)
const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const root = path.resolve(values['source-root']), output = path.resolve(values.output)
if (fs.existsSync(output)) throw new Error('Output must be new; never overwrite an earlier rehearsal')
fs.mkdirSync(path.dirname(output), { recursive: true })
const active = JSON.parse(fs.readFileSync(path.join(root, 'deployments/xlayer-test/active.json')))
if (active.chainId !== 196 || active.phase !== 'test' || active.rpcUrl !== 'https://rpc.ignix.bot/rpc/196') throw new Error('Independent 196 test identity required')
const PUBLIC_READS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_gasPrice', 'eth_getBalance', 'eth_getTransactionCount'])
async function publicRead(method, params = []) {
  if (!PUBLIC_READS.has(method)) throw new Error('Public RPC permits listed reads only')
  const response = await fetch(active.rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30_000) })
  const body = await response.json()
  if (!response.ok || body.error || body.id !== 1) throw new Error(`Read-only public RPC ${method} failed`)
  return body.result
}
if (await publicRead('eth_chainId') !== '0xc4') throw new Error('Public network changed')
const block = await publicRead('eth_getBlockByNumber', ['latest', false]), feeCap = BigInt(await publicRead('eth_gasPrice'))
if (feeCap <= 0n) throw new Error('Missing current gas price')
const realBalance = BigInt(await publicRead('eth_getBalance', [active.owner, block.number]))
const realNonce = await publicRead('eth_getTransactionCount', [active.owner, block.number])
const log = fs.openSync(`${output}.anvil.log`, 'wx')
const child = spawn(values.anvil, ['--host', '127.0.0.1', '--port', '8956', '--chain-id', '196', '--fork-url', active.rpcUrl,
  '--fork-block-number', String(BigInt(block.number)), '--gas-price', String(feeCap), '--silent'], { stdio: ['ignore', log, log] })
const signer = values['persistent-signer'] ? persistentMining196Signer() : privateKeyToAccount(generatePrivateKey()) // private material remains memory-only
const plan = new Mining196Plan(active.owner, output, feeCap, child)
try {
  let ready = false
  for (let attempt = 0; attempt < 600; attempt++) {
    if (child.exitCode !== null) throw new Error('Owned Anvil failed to start')
    try { if (await plan.rpc('eth_chainId') === '0xc4') { ready = true; break } } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!ready) throw new Error('Owned Anvil did not become ready')
  plan.fork = { block: String(BigInt(block.number)), hash: block.hash, publicRpcReadOnly: active.rpcUrl, observedGasPriceWei: String(feeCap), realOwnerBalanceWei: String(realBalance), realOwnerNonce: String(BigInt(realNonce)), observedAt: new Date().toISOString() }
  plan.temporarySigner = { address: signer.address, memoryOnly: !values['persistent-signer'], replacementAndFullRehearsalRequiredBeforePublicBroadcast: !values['persistent-signer'], profileId: '196-mining-test' }
  plan.executionSourceSha256 = Object.fromEntries([
    'rehearse-mining-196.mjs', 'mining-196-signer.mjs', 'mining-196-plan.mjs', 'mining-196-stack.mjs', 'mining-196-artifacts.mjs', 'mining-196-budget.mjs', 'mining-196-deployment.mjs',
    'mining-plan-rpc.mjs', 'mining-plan-artifacts.mjs', 'mining-plan-nfts.mjs', 'mining-plan-business.mjs', 'fee_policy.py',
  ].map((name) => [name, fileSha(fs.readFileSync(path.join(toolRoot, 'scripts/sodadex', name)))]))
  await plan.start()
  const { resolve, proof } = load196Artifacts(values['product-manifest']); plan.artifactProof = proof
  const reuse = JSON.parse(fs.readFileSync(values['reuse-manifest'])), reused = {}
  if (reuse.chainId !== 196 || reuse.stage !== 'test-196') throw new Error('Explicit 196 test reuse manifest required')
  const expected = { wrapped: active.wrappedNative, permit: active.permit2, pm: active.contracts.v4PoolManager, positionManager: active.contracts.v4PositionManager, quoter: active.contracts.v4Quoter }
  plan.reuseProof = {}
  for (const [role, address] of Object.entries(expected)) {
    const row = reuse.contracts[role]
    if (row?.address?.toLowerCase() !== address.toLowerCase() || !/^[a-f0-9]{64}$/.test(row.runtimeSha256)) throw new Error(`Reuse identity mismatch ${role}`)
    const code = await plan.rpc('eth_getCode', [address, 'latest'])
    if (code === '0x' || fileSha(Buffer.from(code.slice(2), 'hex')) !== row.runtimeSha256) throw new Error(`Reuse runtime drift ${role}`)
    reused[role] = address; plan.reuseProof[role] = row
  }
  if ((await plan.call(reused.positionManager, 'function poolManager() view returns(address)')).toLowerCase() !== reused.pm.toLowerCase() ||
      (await plan.call(reused.positionManager, 'function permit2() view returns(address)')).toLowerCase() !== reused.permit.toLowerCase()) throw new Error('Reused PM dependency drift')
  const feeCheck = execFileSync('python3', ['-c', 'import sys;sys.path.insert(0,sys.argv[1]);from fee_policy import require_test_profile;require_test_profile(sys.argv[2],"test-196")', path.join(toolRoot, 'scripts/sodadex'), path.join(toolRoot, 'deployments/fees/test-196.json')], { encoding: 'utf8' })
  if (feeCheck.trim()) throw new Error('Unexpected fee checker output')
  const stack = await prepare196Stack(plan, root, signer.address, resolve, reused)
  await prepareMiningNfts(plan, root, stack)
  await exerciseMiningProducts(plan, root, stack, { chainId: 196, nativeDivisor: 10000n, productArtifact: resolve,
    sign: (digest, raw) => raw ? signer.sign({ hash: digest }) : signer.signMessage({ message: { raw: digest } }) })
  fs.writeFileSync(`${output}.deployment.json`, JSON.stringify(await mining196LocalDeployment(plan), null, 2) + '\n')
  const oracle = '0x420000000000000000000000000000000000000f'
  if (await plan.call(oracle, 'function isFjord() view returns(bool)') !== true || await plan.call(oracle, 'function isIsthmus() view returns(bool)') !== true) throw new Error('Unsupported public fee model')
  let actual = 0n, upper = 0n, additional = 0n
  for (const row of plan.rows) {
    const encoded = serializeTransaction({ type: 'legacy', chainId: 196, nonce: Number(row.nonce), gas: BigInt(row.gas), gasPrice: feeCap, ...(row.to ? { to: row.to } : {}), value: BigInt(row.value), data: row.data })
    const bytes = BigInt((encoded.length - 2) / 2 + 72)
    const l1 = await plan.call(oracle, 'function getL1FeeUpperBound(uint256) view returns(uint256)', [bytes])
    const operator = await plan.call(oracle, 'function getOperatorFee(uint256) view returns(uint256)', [BigInt(row.gas)])
    row.l1FeeUpperBoundWei = String(l1); row.operatorFeeUpperBoundWei = String(operator)
    actual += BigInt(row.gasUsed) * feeCap; upper += BigInt(row.gas) * feeCap; additional += l1 + operator
  }
  const principal = BigInt(plan.businessPrincipal.nativeWei)
  const wrappedLp = await plan.call(stack.v2Factory, 'function getPair(address,address) view returns(address)', [stack.fab, stack.wrapped])
  const recoverableWrapped = await plan.call(stack.wrapped, 'function balanceOf(address) view returns(uint256)', [wrappedLp])
  plan.budget = { approval: 'pending-human-budget-confirmation', gasPriceWei: String(feeCap), actualExecutionAtObservedGasPriceWei: String(actual),
    gasLimitExecutionUpperBoundWei: String(upper), additionalFeeUpperBoundWei: String(additional), totalGasUpperBoundWei: String(upper + additional),
    grossNativePrincipalUpperBoundWei: String(principal), recoverableLpWrappedNativeWei: String(recoverableWrapped),
    requiredGasAndPrincipalWei: String(upper + additional + principal), requiredGasAndPrincipalOKB: formatEther(upper + additional + principal),
    ownerCurrentlyFunded: realBalance >= upper + additional + principal,
    minimumMeaning: 'Observed complete-scenario cost; not a guaranteed global minimum. Gas price, signer and block require refresh before any broadcast.',
    measuredGroups: summarize196Budget(plan.rows, feeCap), backendCallsIncludedInMeasuredBusiness: true, additionalBackendOperatingGasIncluded: false, publicBrowserAcceptanceIncluded: false }
  plan.save()
  console.log(JSON.stringify({ output, transactions: plan.rows.length, ...plan.budget }, null, 2))
} catch (error) {
  plan.failure = error instanceof Error ? error.message : String(error); plan.save(); throw error
} finally { child.kill('SIGTERM'); fs.closeSync(log) }
