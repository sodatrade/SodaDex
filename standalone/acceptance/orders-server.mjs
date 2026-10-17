// Complete browser → compiled Worker → SQLite service → actual owned Anvil contracts.
// Only ephemeral in-memory accounts can sign. No existing wallet or external chain is accessible.
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startOrderFixture } from '../../contracts/sodadex-orders/test/fixture.mjs'
import { orderMessage, orderTypedData, parseLimitOrder } from '../order-types.ts'
import { FIXED, validateConfig } from '../orders/src/config.ts'
import { OrderStore } from '../orders/src/store.ts'
import { OrdersService } from '../orders/src/service.ts'
import { OrdersKeeper } from '../orders/src/keeper.ts'
import { ViemOrderChain } from '../orders/src/chain.ts'
import { createOrdersServer } from '../orders/src/server.ts'
const root = fileURLToPath(new URL('../../', import.meta.url))
const webRequire = createRequire(new URL('../web/package.json', import.meta.url))
const workerRequire = createRequire(new URL('../worker/package.json', import.meta.url))
const { hashTypedData } = webRequire('viem')
const { build } = workerRequire('esbuild')
const { createServer: createViteServer } = await import(pathToFileURL(webRequire.resolve('vite')).href)
const webPort = Number(process.argv[2] ?? '4196')
if (!Number.isSafeInteger(webPort) || webPort < 1 || webPort > 65535) throw Error('Explicit local browser port required')
const origin = `http://127.0.0.1:${webPort}`, originalFetch = globalThis.fetch
const folder = await mkdtemp(resolve(tmpdir(), 'sodadex-orders-browser-'))
const fixture = await startOrderFixture()
const rpcUrl = `http://127.0.0.1:${fixture.fork.port}`
const transactions = [], signatures = []
let store, api, vite, server, timer, stopped = false
function owned() {
  const pid = execFileSync('lsof', ['-nP', `-iTCP@127.0.0.1:${fixture.fork.port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim()
  if (pid !== String(fixture.fork.pid)) throw Error('Owned Anvil listener changed')
}
async function stop() {
  if (stopped) return
  stopped = true; clearInterval(timer)
  if (server) await new Promise(resolveClose => server.close(resolveClose))
  await vite?.close()
  if (api) await new Promise(resolveClose => api.close(resolveClose))
  store?.close(); globalThis.fetch = originalFetch; fixture.fork.stop()
  await rm(folder, { recursive: true, force: true })
}
try {
  owned()
  await fixture.request('anvil_setIntervalMining', [1]); await fixture.request('evm_mine')
  const config = validateConfig({ settlement: fixture.settlement, rpcUrl, publicOrigin: origin, databasePath: resolve(folder, 'orders.sqlite'),
    localTest: true, executionEnabled: true, gasBudgetWei: 10n ** 16n })
  store = new OrderStore(config.databasePath)
  const chain = new ViemOrderChain(config), service = new OrdersService(config, store, chain)
  const keeper = new OrdersKeeper(config, store, chain, { address: fixture.keeper,
    signTransaction: plan => fixture.keeperAccount.signTransaction({ ...plan, type: 'legacy' }) })
  api = createOrdersServer(service)
  await new Promise((resolveListen, reject) => { api.once('error', reject); api.listen(0, '127.0.0.1', resolveListen) })
  const apiOrigin = `http://127.0.0.1:${api.address().port}`
  const manifest = { schemaVersion: 1, chainId: 196, stage: 'test', status: 'ready', settlement: fixture.settlement,
    deploymentBlock: 0, apiOrigin, executionEnabled: true }
  const manifestPath = resolve(root, 'deployments/orders-test.json')
  const workerBundle = resolve(folder, 'worker.mjs')
  await build({ entryPoints: [resolve(root, 'standalone/worker/src/index.ts')], outfile: workerBundle, bundle: true, format: 'esm', platform: 'node', target: 'node22',
    plugins: [{ name: 'owned-orders-test-manifest', setup(builder) { builder.onLoad({ filter: /orders-test\.json$/ }, args =>
      args.path === manifestPath ? { contents: JSON.stringify(manifest), loader: 'json' } : undefined) } }] })
  globalThis.fetch = async (input, init) => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    owned()
    if (target === FIXED.rpcUrl) return originalFetch(rpcUrl, init)
    const address = new URL(target)
    if ((address.origin === rpcUrl && address.pathname === '/' && !address.search && !address.hash) || address.origin === apiOrigin) return originalFetch(input, init)
    throw Error('Non-local upstream blocked by owned browser fixture')
  }
  const cursorCache = new Map()
  globalThis.caches = { default: {
    async match(request) { const entry = cursorCache.get(request.url); return entry && entry.expires > Date.now() ? entry.response.clone() : undefined },
    async put(request, response) { cursorCache.set(request.url, { response: response.clone(), expires: Date.now() + 3_600_000 }) },
  } }
  const worker = (await import(pathToFileURL(workerBundle).href)).default
  vite = await createViteServer({ root: resolve(root, 'standalone/web'), configFile: resolve(root, 'standalone/web/vite.config.ts'),
    plugins: [{ name: 'owned-orders-browser-manifest', enforce: 'pre', load(id) {
      if (id.split('?')[0] === manifestPath) return JSON.stringify(manifest)
    } }], server: { middlewareMode: true, hmr: false, fs: { allow: [root] }, proxy: {} } })
  const walletRequest = async input => {
    if (input.method === 'eth_sendTransaction' && input.params?.length === 1) {
      const tx = input.params[0]
      if (tx.from?.toLowerCase() !== fixture.maker.address.toLowerCase() || BigInt(tx.chainId) !== 196n ||
        Object.keys(tx).some(key => !['from', 'to', 'data', 'value', 'gas', 'chainId'].includes(key)) || BigInt(tx.value ?? '0x0') > 1_000_000_000_000n) throw Error('Unexpected owned wallet intent')
      const simulation = { from: tx.from, to: tx.to, data: tx.data, value: tx.value ?? '0x0' }
      const checked = await worker.fetch(new Request(origin + '/api/rpc', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'owned-wallet', method: 'eth_estimateGas', params: [simulation] }) }), {})
      const result = await checked.json()
      if (!checked.ok || result.error) throw Error('Compiled Worker rejected wallet intent')
      const hash = await fixture.request('eth_sendTransaction', [tx])
      transactions.push({ hash, to: tx.to, value: tx.value, selector: tx.data.slice(0, 10) })
      return hash
    }
    if (input.method === 'eth_signTypedData_v4' && input.params?.length === 2 && input.params[0]?.toLowerCase() === fixture.maker.address.toLowerCase()) {
      const typed = JSON.parse(input.params[1]), witness = typed.message?.witness
      const order = parseLimitOrder({ ...witness, chainId: Number(witness?.chainId), protocol: Number(witness?.protocol),
        pool: { ...witness?.pool, fee: Number(witness?.pool?.fee), tickSpacing: Number(witness?.pool?.tickSpacing) } },
        { settlement: fixture.settlement, wrappedNative: FIXED.wrappedNative, router: FIXED.router, permit2: FIXED.permit2 })
      if (order.maker.toLowerCase() !== fixture.maker.address.toLowerCase()) throw Error('Unexpected test maker')
      const canonical = orderTypedData(order, FIXED.permit2), digest = hashTypedData(canonical)
      if (hashTypedData(typed) !== digest) throw Error('Unexpected typed-data binding')
      await fixture.call(fixture.settlement, fixture.artifact.abi, 'validateOrder', [orderMessage(order)])
      signatures.push({ digest, nonce: order.nonce })
      return fixture.maker.signTypedData(canonical)
    }
    throw Error('Unsupported owned wallet method')
  }
  server = createServer(async (incoming, outgoing) => {
    try {
      if (incoming.headers.host !== `127.0.0.1:${webPort}`) throw Error('Unexpected local host')
      const url = new URL(incoming.url, origin)
      if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/fixture-')) { vite.middlewares(incoming, outgoing); return }
      const chunks = []; let size = 0
      for await (const chunk of incoming) { size += chunk.length; if (size > 16384) throw Error('Local request too large'); chunks.push(chunk) }
      const body = Buffer.concat(chunks)
      let response
      if (url.pathname === '/fixture-status' && incoming.method === 'GET') response = Response.json({ mode: 'owned-orders-anvil', maker: fixture.maker.address,
        settlement: fixture.settlement, timestamp: Number(await fixture.timestamp()), signatures, transactions })
      else if (url.pathname === '/fixture-wallet') {
        if (incoming.method !== 'POST' || incoming.headers.origin !== origin || incoming.headers['x-sodadex-fixture'] !== '1') throw Error('Same-origin fixture marker required')
        owned(); response = Response.json({ result: await walletRequest(JSON.parse(body)) })
      } else response = await worker.fetch(new Request(url, { method: incoming.method, headers: incoming.headers,
        ...(incoming.method === 'GET' || incoming.method === 'HEAD' ? {} : { body }) }), {})
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch { outgoing.writeHead(400, { 'Content-Type': 'application/json' }); outgoing.end(JSON.stringify({ error: 'Owned browser fixture rejected request' })) }
  })
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(webPort, '127.0.0.1', resolveListen) })
  timer = setInterval(() => { void keeper.runOnce().catch(() => {}) }, 500)
  await writeFile(resolve(root, '.analysis/orders/browser-info.json'), JSON.stringify({ origin, maker: fixture.maker.address, settlement: fixture.settlement }, null, 2))
  process.stdout.write(`Owned order browser fixture: ${origin}; all balances and signing accounts are local-only\n`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop().then(() => process.exit(0)) })
} catch (error) { await stop(); throw error }
