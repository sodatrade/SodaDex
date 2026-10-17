/** Real business contracts on the isolated Anvil fixture only. No external wallets or RPC. */
import { createServer } from 'node:http'
import { readFileSync, mkdirSync, chmodSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { keccak256, toHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { parseMiningDeployment } from '../../mining-products.ts'
import { Admission } from '../src/admission.ts'
import { Directory } from '../src/directory.ts'
import { handleRequest, errorResponse } from '../src/http.ts'
import { Keeper } from '../src/keeper.ts'
import { Planner } from '../src/planner.ts'
import { Repository, type StateStorage } from '../src/repository.ts'
import { HttpRpc } from '../src/rpc.ts'
import { validateConfig } from '../src/config.ts'
import { discovery } from '../cloudflare/discovery-adapter.ts'
import { record, ServiceError, type RuntimeConfig } from '../src/types.ts'

const origin = 'http://127.0.0.1:5173', rpcUrl = 'http://127.0.0.1:8954/'
const fixtureRoot = resolve(process.cwd(), '.analysis/mining-1952/browser-online-fixture')
const d = parseMiningDeployment(JSON.parse(readFileSync(resolve(fixtureRoot, 'products.json'), 'utf8')))
const metadata: unknown = JSON.parse(readFileSync(resolve(fixtureRoot, 'addresses.json'), 'utf8'))
if (d.state !== 'ready' || !d.version.startsWith('loopback-online-') || !record(metadata) ||
    typeof metadata.farmListingId !== 'number' || typeof metadata.inventorySeller !== 'string') throw new Error('Explicit online loopback fixture required')
const deployment = d
const authorizer = privateKeyToAccount(`0x${'1952'.padStart(64, '0')}`)
const keeperAccount = privateKeyToAccount(keccak256(toHex('sodadex-online-local-keeper')))
const config: RuntimeConfig = validateConfig({ chainId: 1952, rpcUrl, publicOrigin: origin, admissionEnabled: true, executionEnabled: true,
  expectedSigner: authorizer.address, keeperAddress: keeperAccount.address,
  gasCapWei: 10n ** 17n, maxGasPerTransaction: 8_000_000n, maxGasPriceWei: 10n ** 10n, pollMs: 2000,
  policy: { maxProjects: 3, maxProjectsPerWallet: 2, allowedListingIds: [String(metadata.farmListingId)],
    inventorySeller: metadata.inventorySeller as Hex, maxProcurementFabRaw: 10n * 10n ** 8n,
    maxMinerPriceWei: 10n ** 10n, maxConversionInputRaw: 1_000_000n * 10n ** 18n, slippageBps: 50 },
}, true)
const bootstrap = new HttpRpc(rpcUrl)
if (!/anvil/i.test(String(await bootstrap.request('web3_clientVersion'))) || await bootstrap.request('eth_chainId') !== '0x7a0') throw new Error('Isolated Anvil1952 required')
await discovery.verifyBase(bootstrap, deployment, authorizer.address)
await bootstrap.request('anvil_setBalance', [keeperAccount.address, '0xde0b6b3a7640000'])
const dataRoot = resolve(process.cwd(), '.analysis/mining-online/local-service')
mkdirSync(dataRoot, { recursive: true, mode: 0o700 })
const database = new DatabaseSync(resolve(dataRoot, 'state.sqlite'))
chmodSync(resolve(dataRoot, 'state.sqlite'), 0o600)
database.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)')
const storage: StateStorage = {
  load: () => (database.prepare('SELECT value FROM state WHERE id=1').get() as {value: string} | undefined)?.value,
  save: value => { database.prepare('INSERT INTO state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(value) },
  transaction: operation => { database.exec('BEGIN IMMEDIATE'); try { const result = operation(); database.exec('COMMIT'); return result } catch (e) { database.exec('ROLLBACK'); throw e } },
  sync: async () => {},
}
const repo = new Repository(storage, deployment)
let tail = Promise.resolve(), lastRequests = 0, maximumRequests = 0
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = tail.then(operation); tail = result.then(() => {}, () => {}); return result
}
function app() {
  let requests = 0
  const rpc = new HttpRpc(rpcUrl, async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url !== rpcUrl || ++requests > 45) throw new ServiceError('rpc_event_budget', 503)
    lastRequests = requests; maximumRequests = Math.max(maximumRequests, requests)
    return fetch(input, init)
  })
  const signer = { address: authorizer.address, signMessage: (payload: Hex) => authorizer.signMessage({ message: { raw: payload } }),
    signTypedData: (value: Parameters<typeof authorizer.signTypedData>[0]) => authorizer.signTypedData(value) }
  const planner = new Planner(config, deployment, repo, rpc, discovery, signer)
  return { config, d: deployment, repo, admission: new Admission(config, deployment, repo, rpc, discovery, signer),
    directory: new Directory(config, deployment, repo, rpc, discovery), keeper: new Keeper(config, deployment, repo, rpc, planner,
      {address: keeperAccount.address, signTransaction: plan => keeperAccount.signTransaction(plan)}) }
}
createServer(async (incoming, outgoing) => {
  try {
    if (incoming.headers.origin !== origin) { outgoing.writeHead(403); outgoing.end(); return }
    outgoing.setHeader('Access-Control-Allow-Origin', origin)
    outgoing.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-SodaDEX-Network-Profile')
    outgoing.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    if (incoming.method === 'OPTIONS') { outgoing.writeHead(204); outgoing.end(); return }
    const chunks: Buffer[] = []; let length = 0
    for await (const chunk of incoming) { length += chunk.length; if (length > 16384) throw new ServiceError('body_too_large', 413); chunks.push(Buffer.from(chunk)) }
    const url = new URL(incoming.url ?? '/', 'http://127.0.0.1:8791')
    const request = new Request(url, {method: incoming.method, headers: {Origin: origin, 'Content-Type': 'application/json',
      'X-SodaDEX-Network-Profile': '1952-mining-test'}, ...(['GET','HEAD'].includes(incoming.method ?? 'GET') ? {} : {body: Buffer.concat(chunks).toString('utf8')})})
    const readOnly = request.method === 'GET' && (url.pathname === '/v1/status' || url.pathname === '/v1/projects' && !url.search)
    const response = await (readOnly ? handleRequest(request, app()) : serial(() => handleRequest(request, app())))
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text())
  } catch (e) { const response = errorResponse(e); outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text()) }
}).listen(8791, '127.0.0.1', () => console.log(JSON.stringify({ localOnly: true, rpc: rpcUrl, http: 'http://127.0.0.1:8791', origin, version: deployment.version })))
const timer = setInterval(() => { void serial(async () => {
  try { await app().keeper.runOnce() }
  catch (e) { repo.change(s => { s.jobs.service = {id:'service',kind:'sync',status:'blocked',reason:e instanceof ServiceError ? e.code : 'service_unavailable',updatedAt:Date.now()} }); await repo.flush() }
  console.log(JSON.stringify({localOnly:true,rpcRequests:lastRequests,maximumRequests}))
}) }, 2000)
process.on('SIGTERM', () => { clearInterval(timer); void tail.finally(() => {database.close();process.exit(0)}) })
