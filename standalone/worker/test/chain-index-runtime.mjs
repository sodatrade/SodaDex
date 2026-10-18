// Actual isolated workerd + SQLite; every outbound request is handled by the fixture.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters } from 'viem'
const require = createRequire(import.meta.url), { build } = require('esbuild'), { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = require('miniflare')
const root = fileURLToPath(new URL('../../../', import.meta.url)), folder = await mkdtemp(resolve(tmpdir(), 'sodadex-chain-index-'))
const active = JSON.parse(readFileSync(resolve(root, 'deployments/xlayer-test/pools.json'))), mining = JSON.parse(readFileSync(resolve(root, 'deployments/xlayer-1952/products.json')))
const first = { 196: 73361037, 1952: Number(mining.genesisBlock) }, account = `0x${'11'.repeat(20)}`, recipient = `0x${'22'.repeat(20)}`
const hex = n => `0x${n.toString(16)}`, hash = n => `0x${n.toString(16).padStart(64, '0')}`
let generation = 0, mf, rpcCount = 0
const methods = new Set(), paths = new Set()
const swap = parseAbi(['event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)'])
const erc20 = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)'])
const nft = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)'])
function sourceLogs(chain) {
  const base = { blockNumber: hex(first[chain] + 2), blockHash: hash(first[chain] + 2 + generation * 100000000), removed: false }
  return Array.from({ length: 23 }, (_, i) => ({ ...base, logIndex: hex(i), transactionHash: hash(chain * 100 + i + generation * 1000000),
    address: chain === 196 ? active.v3.address : i === 22 ? mining.contracts.circuits.address : mining.contracts.fab.address,
    topics: chain === 196 ? encodeEventTopics({ abi: swap, eventName: 'Swap', args: { sender: account, recipient } }) : i === 22 ? encodeEventTopics({ abi: nft, eventName: 'Transfer', args: { from: account, to: recipient, tokenId: 5n } }) : encodeEventTopics({ abi: erc20, eventName: 'Transfer', args: { from: account, to: recipient } }),
    data: chain === 196 ? encodeAbiParameters(parseAbiParameters('int256,int256,uint160,uint128,int24'), [1n, -1n, 1n, 1n, 0]) : i === 22 ? '0x' : encodeAbiParameters(parseAbiParameters('uint256'), [BigInt(i + 1)]) }))
}
const entry = resolve(folder, 'entry.ts'), bundle = resolve(folder, 'worker.mjs')
await writeFile(entry, `import {indexedChartSource} from ${JSON.stringify(resolve(root, 'standalone/worker/src/chain-index/chart-source.ts'))};import {chainIndexApi} from ${JSON.stringify(resolve(root, 'standalone/worker/src/chain-index/durable.ts'))};export {SodaChainIndex} from ${JSON.stringify(resolve(root, 'standalone/worker/src/chain-index/durable.ts'))};export default {fetch(request,env){if(new URL(request.url).pathname==='/chart')return indexedChartSource(env)(new URL(request.url)).then(data=>Response.json(data));return chainIndexApi(request,env,new URL(request.url).pathname.startsWith('/mining/')?'1952-mining-test':'196-test')}}`)
await build({ entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'browser', target: 'es2022' })
const options = () => ({ name: 'chain-index-fixture', script: readFileSync(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-18', port: 0, cf: false, log: new Log(LogLevel.NONE),
  durableObjects: { CHAIN_INDEX: { className: 'SodaChainIndex', useSQLite: true } }, resourcePersistencePath: resolve(folder, 'persist'), unsafeInspectDurableObjects: true, telemetry: { enabled: false },
  outboundService: async request => {
    assert.ok(['https://rpc.ignix.bot/rpc/196', 'https://testrpc.xlayer.tech/terigon'].includes(request.url), 'all other network access is prohibited')
    const chain = request.url.includes('/196') ? 196 : 1952, body = await request.json(); methods.add(body.method); paths.add(request.url); rpcCount++
    assert.ok(['eth_chainId', 'eth_getLogs', 'eth_getBlockByNumber'].includes(body.method), 'no signer, wallet, broadcast or simulation access')
    let result
    if (body.method === 'eth_chainId') result = hex(chain)
    else if (body.method === 'eth_getLogs') {
      const filter = body.params[0], addresses = [filter.address].flat().map(a => a.toLowerCase())
      result = sourceLogs(chain).filter(log => addresses.includes(log.address.toLowerCase()) && BigInt(log.blockNumber) >= BigInt(filter.fromBlock) && BigInt(log.blockNumber) <= BigInt(filter.toBlock))
    } else {
      const number = body.params[0] === 'latest' ? first[chain] + 6 : Number(BigInt(body.params[0]))
      result = { number: hex(number), hash: hash(number + generation * 100000000), timestamp: hex(1000), transactions: sourceLogs(chain).filter(log => Number(BigInt(log.blockNumber)) === number).map(log => ({ hash: log.transactionHash, blockHash: log.blockHash, from: account })) }
    }
    return Response.json({ jsonrpc: '2.0', id: body.id, result })
  } })
async function start() { mf = new Miniflare(convertV4MiniflareOptions(options())); await mf.ready }
const read = async path => { const response = await mf.dispatchFetch('https://site.test' + path); return { status: response.status, body: await response.json() } }
async function until(check, label) { for (let i = 0; i < 100; i++) { const result = await check(); if (result) return result; await new Promise(done => setTimeout(done, 100)) }; throw Error('Timeout: ' + label) }
try {
  await start()
  const cold = await read('/api/index/pools'); assert.equal(cold.body.pools.length, 2); assert.equal(cold.body.index.syncing, true)
  const miningCold = await read('/mining/api/index/status'); assert.equal(miningCold.body.chainId, 1952)
  await until(async () => !(await read('/api/index/status')).body.syncing && !(await read('/mining/api/index/status')).body.syncing, 'both actors indexed')
  const chart = await read('/chart?pool=' + active.v3.address + '&interval=5m'); assert.equal(chart.status, 200); assert.equal(chart.body.rows.length, 23); assert.equal(chart.body.rows[0].block.timestamp, 1000)
  const firstPage = await read('/api/index/events'); assert.equal(firstPage.body.events.length, 10); assert.ok(firstPage.body.nextCursor)
  const second = await read('/api/index/events?cursor=' + firstPage.body.nextCursor); assert.equal(second.body.events.length, 10)
  const third = await read('/api/index/events?cursor=' + second.body.nextCursor); assert.equal(third.body.events.length, 3); assert.equal(third.body.nextCursor, null)
  const miningPage = await read('/mining/api/index/events'); assert.equal(miningPage.body.chainId, 1952); assert.equal(miningPage.body.events[0].args.tokenId, '5'); assert.ok(!('value' in miningPage.body.events[0].args)); assert.equal(miningPage.body.events[1].args.value, '22')
  assert.equal((await mf.listDurableObjectIds('CHAIN_INDEX')).length, 2)
  const beforeRestart = rpcCount
  await mf.dispose(); await start()
  const after = await read('/api/index/events'); assert.equal(after.body.events.length, 10); assert.equal(after.body.nextCursor !== null, true)
  assert.ok(rpcCount - beforeRestart <= 2, 'restart reuses persisted rows, no historical scan')
  const savedCursor = after.body.nextCursor
  generation++
  assert.equal((await read('/api/index/events?cursor=' + savedCursor)).status, 409)
  await until(async () => !(await read('/api/index/status')).body.syncing, 'reorg rescan')
  assert.equal((await read('/api/index/events?cursor=' + savedCursor)).status, 409)
  const rebuilt = await read('/api/index/events'); assert.ok(rebuilt.body.events.every(event => event.blockHash === hash(first[196] + 2 + 100000000)))
  assert.equal(rebuilt.body.index.generation, 1)
  process.stdout.write(JSON.stringify({ mode: 'local-workerd-sqlite', isolatedChains: [196, 1952], pageSizes: [10, 10, 3], restartRetainedRows: true, oldCursorRejectedAfterReorg: true, orphanRowsRemoved: true, roleCorrectTransferDecoding: true, methods: [...methods], rpcCount, noSigningOrBroadcast: true }, null, 2) + '\n')
} finally { await mf?.dispose(); await rm(folder, { recursive: true, force: true }) }
