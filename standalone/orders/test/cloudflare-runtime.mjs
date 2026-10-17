// Actual local workerd/SQLite Durable Objects. No Cloudflare account or credentials are consulted.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { encodeFunctionData, parseAbi, keccak256 } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { orderTypedData } from '../../order-types.ts'
import { FIXED } from '../src/config.ts'
const require = createRequire(new URL('../../worker/package.json', import.meta.url))
const { build } = require('esbuild'), { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = require('miniflare')
const root = fileURLToPath(new URL('../../../', import.meta.url)), entry = resolve(root, 'standalone/orders/cloudflare/index.ts')
const folder = await mkdtemp(resolve(tmpdir(), 'sodadex-orders-do-')), bundle = resolve(folder, 'worker.mjs')
let mf, fixture
let signCalls = 0, rpcCalls = 0, heldBroadcasts = 0, broadcastMode = 'hold'
const broadcasts = [], rpcMethods = [], outboundUrls = []
async function compile(manifest) {
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers'], target: 'es2022', plugins: [{ name: 'owned-do-only', setup(builder) {
    if (manifest) builder.onLoad({ filter: /orders-test\.json$/ }, args => args.path === resolve(root, 'deployments/orders-test.json') ? { contents: JSON.stringify(manifest), loader: 'json' } : undefined)
    // Count signer invocations without disclosing the key, signature or raw transaction.
    builder.onLoad({ filter: /orders\/cloudflare\/config\.ts$/ }, async args => {
      const { readFile } = await import('node:fs/promises')
      const source = await readFile(args.path, 'utf8')
      return { contents: source.replace("signTransaction: plan => account.signTransaction({ ...plan, type: 'legacy' })", "signTransaction: async plan => { await fetch('https://owned-do-fixture.invalid/signed', { method: 'POST' }); return account.signTransaction({ ...plan, type: 'legacy' }) }"), loader: 'ts' }
    })
  } }] })
}
const baseBindings = { ORDERS_PUBLIC_ORIGIN: 'https://orders.test', ORDERS_POLL_MS: '1000', ORDERS_EXECUTION_ENABLED: 'false', ORDERS_GAS_BUDGET_WEI: '0' }
function options(bindings) {
  return { name: 'sodadex-orders-test', script: readFileSync(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-17', port: 0, cf: false, log: new Log(LogLevel.NONE), bindings: Object.fromEntries(Object.entries(bindings).filter(([, value]) => value !== undefined)),
    durableObjects: { ORDERS: { className: 'SodaOrders', useSQLite: true } }, resourcePersistencePath: resolve(folder, 'persist'), unsafeInspectDurableObjects: true, telemetry: { enabled: false },
    outboundService: async request => {
      outboundUrls.push(request.url)
      if (request.url === 'https://owned-do-fixture.invalid/signed') { signCalls++; return new Response('ok') }
      if (!fixture || request.url !== FIXED.rpcUrl) throw Error('Non-local DO upstream blocked')
      // The fixture request helper checks its owned Anvil process before every call.
      const payload = await request.json(); rpcCalls++; rpcMethods.push(payload.method)
      if (payload.method === 'eth_sendRawTransaction') {
        const hash = keccak256(payload.params[0]); broadcasts.push(hash)
        if (broadcastMode === 'hold') { heldBroadcasts++; return Response.json({ jsonrpc: '2.0', id: payload.id, error: { code: -32000, message: 'Owned test withheld broadcast' } }) }
      }
      try { return Response.json({ jsonrpc: '2.0', id: payload.id, result: await fixture.request(payload.method, payload.params) }) }
      catch { return Response.json({ jsonrpc: '2.0', id: payload.id, error: { code: -32000, message: 'Owned RPC request failed' } }) }
    } }
}
async function start(bindings) { mf = new Miniflare(convertV4MiniflareOptions(options(bindings))); await mf.ready }
const api = async (path, init) => mf.dispatchFetch('https://orders.test' + path, init)
const pause = ms => new Promise(resolveWait => setTimeout(resolveWait, ms))
async function until(check, label) {
  for (let tries = 0; tries < 200; tries++) { const result = await check(); if (result) return result; await pause(50) }
  throw Error('Timed out waiting for ' + label)
}
async function sql(actor) { return mf.unsafeGetDurableObjectStorage('sodadex-orders-test', 'SodaOrders', { name: actor }) }
try {
  await compile()
  await start(baseBindings)
  const status = await (await api('/v1/status')).json()
  assert.equal(status.reason, 'NOT_DEPLOYED'); assert.equal(status.settlement, null); assert.equal(status.acceptingOrders, false)
  assert.equal((await api('/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400)
  assert.equal((await api('/v1/status', { headers: { Origin: 'https://attacker.invalid' } })).status, 403)
  await api('/v1/status?actor=attacker')
  assert.equal((await mf.listDurableObjectIds('ORDERS')).length, 1)
  const empty = await sql('sodadex-orders:196:undeployed')
  assert.equal((await empty.exec('SELECT COUNT(*) AS n FROM orders'))[0].n, 0)
  assert.equal((await empty.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='keeper_guard'"))[0].n, 0)
  await pause(1100); assert.equal(rpcCalls, 0); assert.equal(signCalls, 0)
  await mf.dispose(); mf = undefined
  const proof = { mode: 'local-workerd-sqlite-do', undeployedStatusDisabled: true, fixedSingleActor: true, noNodePidTable: true, emptyQueueNoRpcOrSigner: true }
  if (process.argv.includes('--integration')) {
    const module = process.env.SODADEX_ORDER_FIXTURE_MODULE ? pathToFileURL(resolve(process.env.SODADEX_ORDER_FIXTURE_MODULE)) : new URL('../../../contracts/sodadex-orders/test/fixture.mjs', import.meta.url)
    fixture = await (await import(module.href)).startOrderFixture()
    // This new dedicated keeper exists only in memory and is unrelated to the owner or fixture maker.
    const key = generatePrivateKey(), keeper = privateKeyToAccount(key)
    await fixture.request('anvil_setBalance', [keeper.address, '0x56bc75e2d63100000'])
    const manifest = { schemaVersion: 1, chainId: 196, stage: 'test', status: 'ready', settlement: fixture.settlement, deploymentBlock: 0, apiOrigin: null, executionEnabled: true }
    await compile(manifest)
    const enabled = { ...baseBindings, ORDERS_EXECUTION_ENABLED: 'true', ORDERS_GAS_BUDGET_WEI: String(10n ** 16n), ORDERS_KEEPER_ADDRESS: keeper.address, ORDERS_KEEPER_PRIVATE_KEY: key }
    await start(enabled)
    const actor = `sodadex-orders:196:${fixture.settlement}`
    let storage = await sql(actor)
    const order = { chainId: 196, settlement: fixture.settlement, maker: fixture.maker.address, receiver: fixture.receiver, inputToken: fixture.wokb, outputToken: fixture.stable,
      amountIn: '1000000000000', minAmountOut: '1', nonce: '3000', expiry: String((await fixture.timestamp()) + 600n), protocol: 3, pool: fixture.v3key }
    const approve = encodeFunctionData({ abi: parseAbi(['function approve(address,uint256) returns(bool)']), functionName: 'approve', args: [FIXED.permit2, BigInt(order.amountIn)] })
    await fixture.send(fixture.maker.address, order.inputToken, approve)
    const signature = await fixture.maker.signTypedData(orderTypedData(order, FIXED.permit2))
    const outputBefore = await fixture.balance(order.outputToken, order.receiver)
    const submitted = await api('/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order, signature }) })
    const accepted = await submitted.json()
    if (submitted.status !== 201) process.stdout.write(JSON.stringify({ diagnostics: { readiness: await (await api('/v1/status')).json(), rpcMethods, rpcCalls, outboundUrls } }) + '\n')
    assert.equal(submitted.status, 201, accepted.code)
    await until(async () => (await storage.exec('SELECT hash FROM executions LIMIT 1'))[0], 'real alarm signing')
    await until(() => heldBroadcasts > 0, 'withheld broadcast')
    const prepared = (await storage.exec('SELECT hash,max_cost FROM executions LIMIT 1'))[0]
    assert.equal(signCalls, 1)
    assert.ok(BigInt(prepared.max_cost) > 0n)
    assert.equal((await storage.exec('SELECT total FROM keeper_budget'))[0].total, prepared.max_cost)
    // Destroy the whole local runtime, then reopen exactly the same DO SQLite storage with execution paused.
    await mf.dispose(); mf = undefined
    await start({ ...enabled, ORDERS_EXECUTION_ENABLED: 'false', ORDERS_KEEPER_PRIVATE_KEY: undefined })
    storage = await sql(actor)
    const paused = await (await api('/v1/status')).json()
    assert.equal(paused.settlement, fixture.settlement); assert.equal(paused.reason, 'EXECUTION_PAUSED')
    const next = { ...order, nonce: '3001' }, nextSignature = await fixture.maker.signTypedData(orderTypedData(next, FIXED.permit2))
    assert.equal((await api('/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: next, signature: nextSignature }) })).status, 503)
    assert.equal((await api('/v1/orders/' + accepted.order.id)).status, 200)
    const heldBeforePause = heldBroadcasts
    await pause(1300)
    assert.equal(signCalls, 1); assert.equal(heldBroadcasts, heldBeforePause)
    assert.equal((await storage.exec('SELECT hash FROM executions'))[0].hash, prepared.hash)
    await mf.setOptions(convertV4MiniflareOptions(options({ ...enabled, ORDERS_GAS_BUDGET_WEI: '1' })))
    storage = await sql(actor)
    await until(async () => (await storage.exec('SELECT reason FROM orders'))[0].reason === 'gas_budget', 'persisted gas reservation gate')
    assert.equal(signCalls, 1); assert.equal(heldBroadcasts, heldBeforePause)
    broadcastMode = 'allow'
    await mf.setOptions(convertV4MiniflareOptions(options(enabled)))
    storage = await sql(actor)
    await api('/v1/orders/' + accepted.order.id)
    await until(async () => (await storage.exec('SELECT status FROM executions'))[0].status === 'confirmed', 'same raw transaction recovery and receipt')
    const current = await (await api('/v1/orders/' + accepted.order.id)).json()
    assert.equal(current.order.status, 'filled'); assert.equal(current.order.txHash, prepared.hash)
    assert.equal(signCalls, 1); assert.ok(broadcasts.every(hash => hash === prepared.hash))
    const received = (await fixture.balance(order.outputToken, order.receiver)) - outputBefore
    assert.ok(received >= 1n)
    const publicText = JSON.stringify(current)
    assert.ok(!publicText.includes(signature) && !publicText.includes(key) && !publicText.includes('raw_tx'))
    const idleRpc = rpcCalls
    await pause(2300)
    assert.equal(rpcCalls, idleRpc)
    // Seed closed historical records, then verify a large real API page never exceeds its event RPC allowance.
    for (let index = 0; index < 16; index++) {
      const historical = { ...order, nonce: String(4000 + index), expiry: String((await fixture.timestamp()) - 1n) }
      const digest = keccak256(new TextEncoder().encode(JSON.stringify(historical)))
      await storage.exec("INSERT INTO orders(id,maker,nonce,order_json,signature,status,created_at,updated_at) VALUES(?,?,?,?,?,'expired',0,0)", digest, order.maker.toLowerCase(), historical.nonce, JSON.stringify(historical), '0x01')
    }
    const beforePage = rpcCalls
    assert.equal((await api('/v1/orders?maker=' + order.maker + '&limit=100')).status, 200)
    const pageRpcCalls = rpcCalls - beforePage
    assert.ok(pageRpcCalls > 0 && pageRpcCalls <= 45)
    Object.assign(proof, { actualOwnedAnvil: true, alarmPreparedDurableTransaction: true, fullRuntimeRestartPreservedHash: true, pauseKeptReadsAndBlockedNewOrders: true, gasReservationSurvivedRestart: true,
      budgetGateBlockedBroadcast: true, signingCalls: signCalls, txHash: prepared.hash, status: current.order.status, amountReceived: String(received), idleAlarmStoppedRpc: true, apiRpcCallsFor100RowPage: pageRpcCalls, apiRpcHardLimit: 45, privateFieldsRedacted: true })
  }
  if (process.env.SODADEX_ORDER_DO_PROOF) await writeFile(resolve(process.env.SODADEX_ORDER_DO_PROOF), JSON.stringify(proof, null, 2))
  process.stdout.write(JSON.stringify(proof, null, 2) + '\n')
} finally { await mf?.dispose(); fixture?.fork.stop(); await rm(folder, { recursive: true, force: true }) }
