import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { fixtureProviderResponse, injectFixtureProvider } from './fixture-provider.mjs'

const script = await readFile(new URL('./fixture-provider.js', import.meta.url), 'utf8')
const owner = '0x1111111111111111111111111111111111111111'
async function browser({ mode = 'owned-anvil-fork', chainId = 196, account = owner,
  url = 'http://127.0.0.1:4173', ok = true, writeOk = true, storage = new Map() } = {}) {
  const events = new Map(), announcements = [], calls = [], labels = [], errors = []
  const window = {
    addEventListener(name, fn) { events.set(name, fn) },
    dispatchEvent(event) { if (event.type === 'eip6963:announceProvider') announcements.push(event.detail) },
  }
  const document = { body: { append(node) { labels.push(node) } }, createElement() { return { setAttribute() {} } } }
  const context = { location: new URL(url), URL, Map, Set, Error, Object, window, document,
    console: { error(...args) { errors.push(args) } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetch: async (target, options) => {
      calls.push({ target, options })
      if (target.endsWith('/fixture-status')) return { ok, json: async () => ({ mode, chainId, owner: account, maker: account }) }
      return { ok: writeOk, json: async () => writeOk ? ({ result: '0x1234' }) : ({ error: 'Rejected' }) }
    },
  }
  await runInNewContext(script, context)
  return { provider: announcements[0]?.provider, info: announcements[0]?.info, events, announcements, calls, labels, errors, window, storage }
}

test('HTML uses only self external resources and rejects reinjection', async () => {
  const html = injectFixtureProvider('<html><head></head><body><div id="root"></div></body></html>')
  assert.match(html, /<script defer src="\/fixture-provider\.js"><\/script>/)
  assert.match(html, /href="\/fixture-provider\.css"/)
  assert.throws(() => injectFixtureProvider(html))
  assert.throws(() => injectFixtureProvider('<body>not an entry</body>'))
  assert.equal(fixtureProviderResponse('/fixture-provider.js', 'POST'), undefined)
  assert.equal(fixtureProviderResponse('/other.js', 'GET'), undefined)
  assert.equal(await fixtureProviderResponse('/fixture-provider.js', 'GET').text(), script)
})

test('no request or provider on public origins, localhost alias, or non-HTTP', async () => {
  for (const url of ['https://sodadex-preview.jsmsdx2025.workers.dev', 'http://localhost:4173', 'https://127.0.0.1:4173', 'http://127.0.0.1']) {
    const result = await browser({ url })
    assert.equal(result.calls.length, 0)
    assert.equal(result.provider, undefined)
  }
})

test('bad fixture identity fails closed without announcement', async () => {
  for (const options of [{ chainId: 1952 }, { mode: 'public-chain' }, { account: '0x123' }, { ok: false }]) {
    const result = await browser(options)
    assert.equal(result.provider, undefined)
    assert.equal(result.calls.length, 1)
    assert.equal(result.errors.length, 1)
  }
})

test('normal EIP-6963 discovery uses explicit local branding and account consent', async () => {
  const result = await browser()
  assert.equal(result.info.name, '本地 Anvil 测试钱包')
  assert.equal(result.window.ethereum, undefined)
  assert.match(result.labels[0].textContent, /不连接公链/)
  result.events.get('eip6963:requestProvider')()
  assert.equal(result.announcements.length, 2)
  assert.equal(JSON.stringify(await result.provider.request({ method: 'eth_accounts' })), '[]')
  await assert.rejects(result.provider.request({ method: 'eth_sendTransaction' }), { code: 4100 })
  assert.equal(JSON.stringify(await result.provider.request({ method: 'eth_requestAccounts' })), JSON.stringify([owner]))
  assert.equal(await result.provider.request({ method: 'eth_chainId' }), '0xc4')
  assert.equal(JSON.stringify(await result.provider.request({ method: 'eth_accounts' })), JSON.stringify([owner]))
  const refreshed = await browser({ storage: result.storage })
  assert.equal(JSON.stringify(await refreshed.provider.request({ method: 'eth_accounts' })), JSON.stringify([owner]))
})

test('connected writes retain exact payload and same-origin marker', async () => {
  const result = await browser()
  await result.provider.request({ method: 'eth_requestAccounts' })
  const request = { method: 'eth_sendTransaction', params: [{ from: owner, to: owner, value: '0x0', chainId: '0xc4', data: '0x' }] }
  assert.equal(await result.provider.request(request), '0x1234')
  const sent = result.calls.at(-1)
  assert.equal(sent.target, 'http://127.0.0.1:4173/fixture-wallet')
  assert.equal(sent.options.headers['X-SodaDex-Fixture'], '1')
  assert.equal(sent.options.body, JSON.stringify(request))
  assert.equal(sent.options.credentials, 'omit')
})

test('unsupported methods and chain changes never reach the server', async () => {
  const result = await browser()
  await result.provider.request({ method: 'eth_requestAccounts' })
  for (const request of [{ method: 'eth_sendRawTransaction' }, { method: 'personal_sign' }, { method: 'anvil_setBalance' },
    { method: 'eth_signTypedData_v4' }, { method: 'wallet_addEthereumChain' }, { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x7a0' }] }])
    await assert.rejects(result.provider.request(request), { code: 4200 })
  assert.equal(await result.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xc4' }] }), null)
  assert.equal(result.calls.length, 1)
})

test('only orders mode forwards typed signatures; server rejection remains failure', async () => {
  const result = await browser({ mode: 'owned-orders-anvil' })
  await result.provider.request({ method: 'eth_requestAccounts' })
  assert.equal(await result.provider.request({ method: 'eth_signTypedData_v4', params: [owner, '{}'] }), '0x1234')
  const rejected = await browser({ writeOk: false })
  await rejected.provider.request({ method: 'eth_requestAccounts' })
  await assert.rejects(rejected.provider.request({ method: 'eth_sendTransaction', params: [] }), /rejected/)
})

test('wallet call diagnostics cannot mutate the captured calls', async () => {
  const result = await browser()
  await result.provider.request({ method: 'eth_chainId' })
  result.window.sodaLocalFixtureCalls.push('injected')
  assert.equal(JSON.stringify(result.window.sodaLocalFixtureCalls), '["eth_chainId"]')
})
