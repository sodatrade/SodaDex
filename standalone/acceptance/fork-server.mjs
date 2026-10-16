// Browser acceptance adapter for an OWNED, disposable Anvil fork. No key is loaded.
// Usage: node fork-server.mjs <wrangler dry-run bundle.mjs> <anvil port> <anvil PID> [web port]
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [bundle, forkPort, forkPid, webPort = '4173'] = process.argv.slice(2)
if (!bundle || !/^\d+$/.test(forkPort ?? '') || !/^\d+$/.test(forkPid ?? '') || !/^\d+$/.test(webPort)) throw new Error('Explicit bundle, fork port and owned PID required')
const origin = `http://127.0.0.1:${webPort}`
const nodeUrl = `http://127.0.0.1:${forkPort}`
const config = JSON.parse(await readFile(resolve(root, '../deployments/xlayer-test/active.json'), 'utf8'))
const pools = JSON.parse(await readFile(resolve(root, '../deployments/xlayer-test/pools.json'), 'utf8'))
const owner = config.owner.toLowerCase()
const assets = resolve(root, 'web/dist')
const originalFetch = globalThis.fetch
let rpcId = 0
const transactions = []
function owned() {
  const listeners = execFileSync('lsof', ['-nP', `-iTCP@127.0.0.1:${forkPort}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n')
  if (listeners.length !== 1 || listeners[0] !== forkPid) throw new Error('Anvil listener ownership changed')
}
async function rpc(method, params = []) {
  owned()
  const response = await originalFetch(nodeUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) })
  const result = await response.json()
  if (result.error) throw new Error(`Fork ${method} rejected`)
  return result.result
}
if (!(await rpc('web3_clientVersion')).toLowerCase().includes('anvil') || BigInt(await rpc('eth_chainId')) !== 196n) throw new Error('Expected owned chain-196 Anvil fork')
// The actual compiled Worker still validates every request. Only its fixed read
// transport is redirected, inside this process, to the owned fork.
globalThis.fetch = async (input, init) => {
  if (String(input) !== config.rpcUrl) throw new Error('Fixture disallows all other upstreams')
  owned()
  return originalFetch(nodeUrl, init)
}
const worker = (await import(pathToFileURL(resolve(bundle)).href)).default
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const env = { ASSETS: { async fetch(request) {
  const pathname = decodeURIComponent(new URL(request.url).pathname)
  let path = resolve(assets, '.' + pathname)
  if (path !== assets && !path.startsWith(assets + sep)) return new Response('Not found', { status: 404 })
  let body
  try { body = await readFile(path) } catch { path = resolve(assets, 'index.html'); body = await readFile(path) }
  return new Response(body, { headers: { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' } })
} } }

const server = createServer(async (incoming, outgoing) => {
  try {
    if (incoming.headers.host !== `127.0.0.1:${webPort}`) throw new Error('Invalid fixture host')
    const url = new URL(incoming.url, origin)
    let size = 0
    const chunks = []
    for await (const chunk of incoming) { size += chunk.length; if (size > 16384) throw new Error('Fixture request too large'); chunks.push(chunk) }
    const body = Buffer.concat(chunks)
    let response
    if (url.pathname === '/fixture-status' && incoming.method === 'GET') {
      response = Response.json({ mode: 'owned-anvil-fork', owner: config.owner, contracts: config.contracts, stable: pools.stable.address, wrappedNative: config.wrappedNative, v3Pool: pools.v3.address, v4PoolId: pools.v4.poolId, transactions })
    } else if (url.pathname === '/fixture-wallet') {
      if (incoming.method !== 'POST' || incoming.headers.origin !== origin || incoming.headers['x-sodadex-fixture'] !== '1') throw new Error('Same-origin fork fixture required')
      const input = JSON.parse(body)
      if (input.method !== 'eth_sendTransaction' || input.params?.length !== 1) throw new Error('Only fork transaction submission is exposed')
      const tx = input.params[0]
      if (typeof tx.from !== 'string' || tx.from.toLowerCase() !== owner || BigInt(tx.chainId) !== 196n ||
        Object.keys(tx).some((key) => !['from', 'to', 'data', 'value', 'gas', 'chainId'].includes(key)) ||
        BigInt(tx.value) > 1_000_000_000_000n) throw new Error('Unexpected fork intent')
      const simulation = { from: tx.from, to: tx.to, data: tx.data, value: tx.value }
      const checked = await worker.fetch(new Request(origin + '/api/rpc', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'fixture-check', method: 'eth_estimateGas', params: [simulation] }) }), env)
      const result = await checked.json()
      if (!checked.ok || result.error) throw new Error('Compiled Worker rejected fork intent')
      const hash = await rpc('eth_sendTransaction', [tx])
      transactions.push({ hash, from: tx.from, to: tx.to, value: tx.value, selector: tx.data.slice(0, 10) })
      response = Response.json({ result: hash })
    } else {
      response = await worker.fetch(new Request(url, { method: incoming.method, headers: incoming.headers,
        ...(incoming.method === 'GET' || incoming.method === 'HEAD' ? {} : { body }) }), env)
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    outgoing.end(Buffer.from(await response.arrayBuffer()))
  } catch {
    outgoing.writeHead(400, { 'Content-Type': 'application/json' })
    outgoing.end(JSON.stringify({ error: 'Fork fixture rejected request' }))
  }
})
server.listen(Number(webPort), '127.0.0.1', () => process.stdout.write(`Owned-fork browser fixture: ${origin}; real-chain broadcasting disabled\n`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
