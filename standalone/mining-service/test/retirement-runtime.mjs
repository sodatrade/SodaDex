// Local workerd only. No credentials or live chain requests are used.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(new URL('../../worker/package.json', import.meta.url))
const { build } = require('esbuild'), { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = require('miniflare')
const root = fileURLToPath(new URL('../../../', import.meta.url)), folder = await mkdtemp(resolve(tmpdir(), 'soda-mining-retirement-'))
const bundle = resolve(folder, 'worker.mjs'), deployment = JSON.parse(readFileSync(resolve(root, 'deployments/xlayer-1952/products.json'), 'utf8'))
let mf, outbound = 0
try {
  await build({ entryPoints: [resolve(root, 'standalone/mining-service/cloudflare/index.ts')], outfile: bundle, bundle: true, nodePaths: [resolve(root, 'standalone/mining-service/node_modules')], format: 'esm', platform: 'browser', external: ['cloudflare:workers'], target: 'es2022', plugins: [{ name: 'owned-alarm-fixture', setup(builder) {
    builder.onLoad({ filter: /mining-service\/cloudflare\/index\.ts$/ }, args => {
      const source = readFileSync(args.path, 'utf8')
      // Only this local bundle can arm/invoke the real alarm method for verification.
      const helper = `fetch(request: Request): Promise<Response> {
        if (new URL(request.url).pathname === '/__fixture/arm') return this.state.storage.setAlarm(Date.now()+60000).then(async () => Response.json({alarm:await this.state.storage.getAlarm()}));
        if (new URL(request.url).pathname === '/__fixture/alarm') return this.alarm().then(async () => Response.json({alarm:await this.state.storage.getAlarm()}));`
      return { contents: source.replace('fetch(request: Request): Promise<Response> {', helper), loader: 'ts' }
    })
  } }] })
  mf = new Miniflare(convertV4MiniflareOptions({ name: 'retired-mining-test', script: readFileSync(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-17', port: 0, cf: false,
    log: new Log(LogLevel.NONE), resourcePersistencePath: resolve(folder, 'persist'), unsafeInspectDurableObjects: true, telemetry: { enabled: false },
    durableObjects: { MINING_1952: { className: 'SodaMining1952', useSQLite: true } },
    bindings: { MINING_PUBLIC_ORIGIN: 'https://mining.test', MINING_SERVICE_RETIRED: 'true', MINING_ADMISSION_ENABLED: 'true', MINING_EXECUTION_ENABLED: 'true',
      MINING_GAS_CAP_WEI: '1000000', MINING_POLL_MS: '1000', MINING_SIGNER_PRIVATE_KEY: 'unused-local-fixture', MINING_KEEPER_PRIVATE_KEY: 'unused-local-fixture' },
    outboundService: () => { outbound++; throw Error('Retired service attempted network access') },
  }))
  await mf.ready
  const api = (path, method = 'GET') => mf.dispatchFetch('https://mining.internal' + path, { method, headers: { Origin: 'https://mining.test', 'X-SodaDEX-Network-Profile': '1952-mining-test' } })
  const status = await (await api('/v1/status')).json()
  assert.equal(status.retired, true); assert.equal(status.executionEnabled, false); assert.equal(status.admissionEnabled, false)
  const storage = await mf.unsafeGetDurableObjectStorage('retired-mining-test', 'SodaMining1952', { name: `sodadex-mining:1952:${deployment.version}` })
  const saved = JSON.parse((await storage.exec('SELECT value FROM mining_1952_state WHERE id=1'))[0].value)
  saved.spentWei = '123'; saved.reservedWei = '456'; saved.executions.archived = { raw: 'local-fixture-not-a-transaction', status: 'prepared' }
  saved.challenges.archived = { status: 'authorized', requestId: 'archived' }
  const before = JSON.stringify(saved)
  await storage.exec('UPDATE mining_1952_state SET value=? WHERE id=1', before)
  assert.ok((await (await api('/__fixture/arm')).json()).alarm)
  assert.equal((await (await api('/__fixture/alarm')).json()).alarm, null)
  for (const path of ['/v1/challenge', '/v1/launch', '/v1/register', '/v1/run']) assert.equal((await api(path, 'POST')).status, 410)
  assert.equal((await api('/v1/projects?token=0x1111111111111111111111111111111111111111')).status, 410)
  assert.equal((await api('/v1/projects')).status, 200)
  const after = await (await api('/v1/status')).json()
  assert.equal(after.budget.spentWei, '123'); assert.equal(after.budget.reservedWei, '456')
  assert.equal((await storage.exec('SELECT value FROM mining_1952_state WHERE id=1'))[0].value, before)
  assert.equal(outbound, 0)
  process.stdout.write(JSON.stringify({ mode: 'local-workerd-sqlite', retired: true, writesRejected: true, alarmCleared: true, historicalRowUnchanged: true, signerCredentialsUnused: true, outboundRequests: outbound }, null, 2) + '\n')
} finally { await mf?.dispose(); await rm(folder, { recursive: true, force: true }) }
