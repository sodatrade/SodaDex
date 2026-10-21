// No keys and no public writes. Run only against an explicitly owned Anvil fork.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { encodeDeployData, keccak256, type Address, type Hex } from 'viem'
import config from '../../deployments/xlayer-test/active.json'
import { V2 } from '../v2-protocol'
import { NATIVE_CURRENCY } from '../web/src/liquidity/config'
import { discoverV2, getV2Position } from '../web/src/liquidity/v2Pools'
import { prepareV2, type V2Operation } from '../web/src/liquidity/v2Preview'
import { executeV2 } from '../web/src/liquidity/v2Execution'
import { executePoolTrade, getPoolTradeQuote } from '../web/src/trading/poolTrade'
import { executePoolExactOutput, getPoolExactOutputQuote } from '../web/src/trading/poolExactOutput'
import type { Currency, PublicRpc } from '../web/src/liquidity/types'
const [port, pid, artifactPath, output] = process.argv.slice(2)
if (!/^\d+$/.test(port ?? '') || !/^\d+$/.test(pid ?? '') || !artifactPath || !output) throw Error('Owned fork, reviewed artifact and output required')
if (fs.existsSync(output)) throw Error('Preserve the existing rehearsal')
const artifactBytes = fs.readFileSync(artifactPath)
const artifactSha256 = createHash('sha256').update(artifactBytes).digest('hex')
if (artifactSha256 !== '71bf9ff5fba2319e37cad42a7a9e2c44c71716c7dac4c82308c06f431ef81b74') throw Error('Reviewed TEST ERC20 artifact changed')
const artifact = JSON.parse(artifactBytes.toString('utf8'))
const owner = config.owner as Address, rows: Record<string, unknown>[] = []
let label = '', tokenMax = 0n, fabMax = 0n
const read: PublicRpc = async (method, params = []) => {
  if (execFileSync('lsof', ['-nP', `-iTCP@127.0.0.1:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim() !== pid) throw Error('Fork ownership changed')
  const r = await (await fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(60000) })).json()
  if (r.error) throw Error(`${method}: ${JSON.stringify(r.error)}`)
  return r.result
}
if (await read('eth_chainId') !== '0xc4' || !String(await read('web3_clientVersion')).toLowerCase().includes('anvil')) throw Error('Owned Anvil 196 required')
const startNonce = Number(BigInt(await read('eth_getTransactionCount', [owner, 'latest']) as string))
const initialBlock = await read('eth_blockNumber')
const fab: Currency = { address: '0x842b7bf61f2cb4be8aacac6adece3244c2a6f6ab', native: false, decimals: 8, symbol: 'TEST-FAB', name: 'TEST-FAB' }
const runtimeHashes: Record<string, string> = {}
for (const address of [V2.factory, V2.router, V2.wrapped, fab.address]) {
  const code = await read('eth_getCode', [address, 'latest']) as Hex
  if (code === '0x') throw Error('Missing TEST runtime')
  runtimeHashes[address.toLowerCase()] = keccak256(code)
}
await read('anvil_impersonateAccount', [owner])
await read('evm_setNextBlockTimestamp', [Math.floor(Date.now() / 1000)])
await read('evm_mine')
const wait = async (_read: PublicRpc, hash: Hex): Promise<void> => {
  if ((await read('eth_getTransactionReceipt', [hash]) as { status: string })?.status !== '0x1') throw Error('Local receipt failed')
}
const provider = { request: async ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
  if (method === 'eth_accounts') return [owner]
  if (method === 'eth_chainId') return '0xc4'
  if (method !== 'eth_sendTransaction') throw Error('Unsupported rehearsal method')
  const tx = (params as Record<string, unknown>[])[0]
  const gasEstimate = BigInt(await read('eth_estimateGas', [{ from: owner, to: tx.to, data: tx.data, value: tx.value ?? '0x0' }]) as string)
  const plannedGasLimit = gasEstimate * 110n / 100n + 1n
  const hash = await read(method, [{ ...tx, from: owner, gas: '0x' + plannedGasLimit.toString(16), gasPrice: '0x1406f40' }]) as Hex
  await read('evm_mine'); await wait(read, hash)
  const r = await read('eth_getTransactionReceipt', [hash]) as { gasUsed: string; effectiveGasPrice: string; contractAddress: string | null }
  rows.push({ label, to: tx.to ?? null, data: tx.data, value: String(BigInt(String(tx.value ?? '0x0'))),
    maximumFabSpendRaw: String(tx.to === V2.router ? fabMax : 0n), maximumTestTokenSpendRaw: String(tx.to === V2.router ? tokenMax : 0n),
    gasEstimate: String(gasEstimate), plannedGasLimit: String(plannedGasLimit), hash, createdAddress: r.contractAddress,
    gasUsed: String(BigInt(r.gasUsed)), feeWei: String(BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice)) })
  return hash
} }
const identity = { address: owner, chainId: 196, revision: 1, provider }
const context = { identity, getIdentity: () => identity, isCurrentForm: () => true, onProgress: () => {}, read, wait }
label = 'deploy-standard-test-token'
const deployed = await provider.request({ method: 'eth_sendTransaction', params: [{ from: owner,
  data: encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: ['SodaDEX V2 TEST', 'TEST-V2', owner, owner] }) }] })
const tokenAddress = (await read('eth_getTransactionReceipt', [deployed]) as { contractAddress: Address }).contractAddress
const token: Currency = { ...fab, address: tokenAddress, symbol: 'TEST-V2', name: 'SodaDEX V2 TEST' }
const result = []
const perform = async (op: V2Operation): Promise<void> => { await executeV2(await prepareV2(op, owner, read), context) }
for (const native of [false, true]) {
  const currency = native ? NATIVE_CURRENCY : token
  let pool = await discoverV2(fab, currency, read)
  const baseline = (await getV2Position(pool, owner, read)).balance
  if (!native && pool.address) throw Error('New token pair already exists')
  const amounts = (fabAmount: bigint, other: bigint) => pool.currency0.address.toLowerCase() === fab.address.toLowerCase() ?
    { amount0: fabAmount, amount1: other } : { amount0: other, amount1: fabAmount }
  label = native ? 'native:add-to-existing' : 'token-token:create-and-first-add'
  fabMax = native ? 10n ** 9n : 10n ** 10n; tokenMax = native ? 0n : 10n ** 10n
  await perform({ kind: 'add', pool, ...amounts(fabMax, native ? 10n ** 10n : tokenMax), slippageBps: 50 })
  pool = await discoverV2(fab, currency, read)
  if (!native) {
    label = 'token-token:increase'; fabMax = tokenMax = 10n ** 9n
    await perform({ kind: 'add', pool, ...amounts(fabMax, tokenMax), slippageBps: 50 })
  }
  for (const fabIn of [false, true]) {
    const direction = fabIn === (pool.currency0.address.toLowerCase() === fab.address.toLowerCase())
    const amount = fabIn ? 10n ** 7n : native ? 10n ** 8n : 10n ** 7n
    label = `${native ? 'native' : 'token-token'}:${fabIn ? 'sell-fab' : 'buy-fab'}`
    fabMax = fabIn ? amount : 0n; tokenMax = !fabIn && !native ? amount : 0n
    await executePoolTrade(await getPoolTradeQuote(pool, direction, amount, 50, read), context)
    if (!native) {
      label += ':exact-output'
      const quote = await getPoolExactOutputQuote(pool, direction, 10n ** 6n, 50, read)
      fabMax = fabIn ? quote.maximumIn : 0n; tokenMax = fabIn ? 0n : quote.maximumIn
      await executePoolExactOutput(quote, context)
    }
  }
  for (const half of native ? [false] : [true, false]) {
    const owned = (await getV2Position(pool, owner, read)).balance
    if (owned <= baseline) throw Error('No newly added LP')
    label = `${native ? 'native' : 'token-token'}:${half ? 'remove-half' : 'remove-all-added'}`; fabMax = tokenMax = 0n
    await perform({ kind: 'remove', pool, liquidity: half ? (owned - baseline) / 2n : owned - baseline, slippageBps: 50 })
  }
  const finalLp = (await getV2Position(pool, owner, read)).balance
  if (finalLp !== baseline) throw Error('Pre-existing LP changed')
  result.push({ native, pair: pool.address, baselineLp: String(baseline), finalLp: String(finalLp) })
}
const totals = rows.reduce((t, r) => ({ gas: t.gas + BigInt(r.plannedGasLimit as string) * 30000000n,
  native: t.native + BigInt(r.value as string), fab: t.fab + BigInt(r.maximumFabSpendRaw as string),
  token: t.token + BigInt(r.maximumTestTokenSpendRaw as string), actualGas: t.actualGas + BigInt(r.feeWei as string) }),
  { gas: 0n, native: 0n, fab: 0n, token: 0n, actualGas: 0n })
const report = { mode: 'owned-final-signer-fork', publicChainWrites: 0, chainId: 196, owner, initialBlock, startNonce, artifactSha256,
  tokenAddress, runtimeHashes, results: result, rows, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, String(v)])) }
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ startNonce, transactions: rows.length, results: result, totals: report.totals, publicChainWrites: 0 }))
