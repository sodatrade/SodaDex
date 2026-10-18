// Starts an offline snapshot with the production application and compiled Worker.
// All paths are public bytecode/state fixtures, never wallets or credentials.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startLiquidityFork } from '../web/tests/liquidityForkFixture.ts'
import { installFixtureMetadata } from './fixture-metadata.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(new URL('../worker/package.json', import.meta.url))
const { build } = require('esbuild')
const webPort = process.argv[2] ?? '4173'
if (!/^\d+$/.test(webPort) || Number(webPort) < 1 || Number(webPort) > 65535) throw Error('Local browser port required')
const fixturePath = process.env.SODADEX_LP_FORK_STATE
const stateViewCodePath = process.env.SODADEX_LP_STATEVIEW_CODE
const runtimesPath = process.env.SODADEX_TRADE_RUNTIMES
if (!fixturePath || !stateViewCodePath || !runtimesPath) throw Error('Explicit snapshot, StateView and quoter runtime fixture paths required')
const config = JSON.parse(await readFile(resolve(root, 'deployments/xlayer-test/active.json'), 'utf8'))
const runtimes = JSON.parse(await readFile(runtimesPath, 'utf8'))
if (runtimes.chainId !== 196 || !Array.isArray(runtimes.contracts)) throw Error('Chain-196 runtime fixture required')
const assets = resolve(process.env.SODADEX_FIXTURE_ASSETS ?? resolve(root, 'standalone/web/dist'))
await readFile(resolve(assets, 'index.html'))
const folder = await mkdtemp(resolve(tmpdir(), 'sodadex-browser-fork-'))
let fork, server, stopped = false
async function stop() {
  if (stopped) return
  stopped = true
  if (server?.exitCode === null) {
    server.kill('SIGTERM')
    await new Promise(resolveClose => server.once('exit', resolveClose))
  }
  fork?.stop()
  await rm(folder, { recursive: true, force: true })
}
try {
  fork = await startLiquidityFork({ fixturePath, stateViewCodePath })
  await installFixtureMetadata(fork.request)
  for (const address of [config.contracts.v3Quoter, config.contracts.v4Quoter]) {
    const code = runtimes.contracts.find(contract => contract.address.toLowerCase() === address.toLowerCase())?.code
    if (typeof code !== 'string' || !/^0x[0-9a-f]+$/i.test(code)) throw Error('Active quoter runtime missing')
    await fork.request('anvil_setCode', [address, code])
  }
  const bundle = resolve(folder, 'worker.mjs')
  await build({ entryPoints: [resolve(root, 'standalone/worker/src/index.ts')], outfile: bundle,
    bundle: true, format: 'esm', platform: 'node', target: 'node22', nodePaths: [resolve(root, 'standalone/worker/node_modules')],
    plugins: [{ name: 'local-fixture-preferences', setup(builder) {
      builder.onResolve({ filter: /preferences-script\.json$/ }, () => ({ path: resolve(assets, 'preferences-script.json') }))
    } }] })
  server = spawn(process.execPath, [resolve(root, 'standalone/acceptance/fork-server.mjs'), bundle, String(fork.port), String(fork.pid), webPort], { stdio: 'inherit' })
  server.once('exit', code => { if (!stopped) process.exitCode = code ?? 1; void stop() })
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop().then(() => process.exit(0)) })
  process.stdout.write(`Owned Anvil PID ${fork.pid}, RPC 127.0.0.1:${fork.port}; no remote RPC configured\n`)
} catch (error) { await stop(); throw error }
