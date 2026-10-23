// Read/negative-intent checks only. Never submits a valid transaction or signature.
import assert from 'node:assert/strict'
const origin = process.argv[2]
if (!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin ?? '')) throw Error('Explicit numeric localhost fixture origin required')
const status = async () => {
  const response = await fetch(origin + '/fixture-status')
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.ok(['owned-anvil-fork', 'owned-orders-anvil'].includes(result.mode))
  assert.equal(result.chainId, 196)
  return result
}
const before = await status(), account = before.owner ?? before.maker
const html = await (await fetch(origin + '/')).text()
assert.match(html, /src="\/fixture-provider\.js"/)
const script = await fetch(origin + '/fixture-provider.js')
assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8')
assert.match(await script.text(), /本地 Anvil 测试钱包/)
assert.equal((await fetch(origin + '/fixture-provider.css')).status, 200)
const tx = { from: account, to: account, value: '0x0', data: '0x', chainId: '0xc4', gas: '0x5208' }
const request = { method: 'eth_sendTransaction', params: [tx] }
const headers = { Origin: origin, 'X-SodaDex-Fixture': '1', 'Content-Type': 'application/json' }
const reject = async (payload, overrides = {}) => {
  const response = await fetch(origin + '/fixture-wallet', { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify(payload) })
  assert.equal(response.status, 400)
}
await reject(request, { Origin: 'https://example.com' })
await reject(request, { Origin: '' })
await reject(request, { 'X-SodaDex-Fixture': '0' })
await reject(request, { Host: 'example.com' })
await reject({ method: 'eth_sendRawTransaction', params: ['0x00'] })
await reject({ method: 'personal_sign', params: ['0x00', account] })
await reject({ method: 'eth_sendTransaction', params: [{ ...tx, from: '0x1111111111111111111111111111111111111111' }] })
await reject({ method: 'eth_sendTransaction', params: [{ ...tx, chainId: '0x7a0' }] })
await reject({ method: 'eth_sendTransaction', params: [{ ...tx, value: '0xe8d4a51001' }] })
await reject({ method: 'eth_sendTransaction', params: [{ ...tx, nonce: '0x0' }] })
await reject({ method: 'eth_sendTransaction', params: [{ ...tx, data: '0x' + '00'.repeat(17000) }] })
await reject({ method: 'eth_signTypedData_v4', params: [account, '{}'] })
const after = await status()
assert.equal(after.transactions.length, before.transactions.length)
assert.equal(after.signatures?.length, before.signatures?.length)
console.log(JSON.stringify({ origin, mode: before.mode, negativeIntents: 12, newTransactions: 0, newSignatures: 0, externalProviderLoaded: true }))
