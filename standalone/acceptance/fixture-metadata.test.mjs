import assert from 'node:assert/strict'
import { before, after, beforeEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { startLiquidityFork } from '../web/tests/liquidityForkFixture.ts'
import { installFixtureMetadata } from './fixture-metadata.mjs'

const metadata = JSON.parse(await readFile(new URL('./fixtures/usdt0-metadata.json', import.meta.url), 'utf8'))
const deployment = JSON.parse(await readFile(new URL('../../deployments/xlayer-test/active.json', import.meta.url), 'utf8'))
const pools = JSON.parse(await readFile(new URL('../../deployments/xlayer-test/pools.json', import.meta.url), 'utf8'))
let fork, snapshot, requests
const tracked = async (method, params = []) => { requests.push({ method, params }); return fork.request(method, params) }
const writes = () => requests.filter(request => request.method.startsWith('anvil_set'))
const call = (address, data) => fork.request('eth_call', [{ to: address, data }, 'latest'])
const balance = address => call(metadata.address, '0x70a08231' + address.slice(2).padStart(64, '0'))
const word = value => '0x' + BigInt(value).toString(16).padStart(64, '0')

before(async () => {
  if (!process.env.SODADEX_LP_FORK_STATE || !process.env.SODADEX_LP_STATEVIEW_CODE)
    throw Error('Explicit owned offline snapshot and StateView paths required; no metadata tests are skipped')
  fork = await startLiquidityFork({ fixturePath: process.env.SODADEX_LP_FORK_STATE, stateViewCodePath: process.env.SODADEX_LP_STATEVIEW_CODE })
  snapshot = await fork.request('evm_snapshot')
})
beforeEach(async () => {
  assert.equal(await fork.request('evm_revert', [snapshot]), true)
  snapshot = await fork.request('evm_snapshot')
  requests = []
})
after(() => fork?.stop())

test('fills only the three missing reviewed slots; metadata calls recover without changing funds or pool state', async () => {
  assert.equal(BigInt(await call(metadata.address, '0x313ce567')), 0n)
  const balances = await Promise.all([deployment.owner, pools.v3.address, deployment.contracts.v4PoolManager].map(balance))
  const slot0 = await call(pools.v3.address, '0x3850c7bd')
  const result = await installFixtureMetadata(tracked)
  assert.deepEqual(result.changedSlots, ['0x36', '0x37', '0x100'])
  assert.equal(result.decimals, 6)
  assert.equal(result.name, 'USD₮0')
  assert.equal(result.symbol, 'USD₮0')
  for (const [selector, expected] of Object.entries(metadata.calls)) assert.equal(await call(metadata.address, selector), expected)
  assert.deepEqual(await Promise.all([deployment.owner, pools.v3.address, deployment.contracts.v4PoolManager].map(balance)), balances)
  assert.equal(await call(pools.v3.address, '0x3850c7bd'), slot0)
  assert.equal(writes().length, 3)
  assert.ok(writes().every(({ params }) => params[0] === metadata.address))
})

test('repeated setup is idempotent and does not alter a different valid zero-decimal token', async () => {
  const other = '0x1111111111111111111111111111111111111111'
  await fork.request('anvil_setCode', [other, '0x600060005260206000f3'])
  await installFixtureMetadata(tracked)
  requests = []
  assert.deepEqual((await installFixtureMetadata(tracked)).changedSlots, [])
  assert.equal(BigInt(await call(other, '0x313ce567')), 0n)
  assert.equal(writes().length, 0)
  assert.ok(!requests.some(({ params }) => params[0] === other))
})

test('different chain or non-Anvil client stops before metadata writes', async () => {
  for (const override of [{ method: 'eth_chainId', value: '0x7a0' }, { method: 'web3_clientVersion', value: 'geth/v1' }]) {
    await assert.rejects(installFixtureMetadata((method, params) => method === override.method ? Promise.resolve(override.value) : tracked(method, params)), /Owned chain-196/)
    assert.equal(writes().length, 0)
  }
})

test('changed proxy code is rejected before storage writes', async () => {
  await fork.request('anvil_setCode', [metadata.address, '0x600060005260206000f3'])
  await assert.rejects(installFixtureMetadata(tracked), /runtime identity mismatch/)
  assert.equal(writes().length, 0)
})

test('changed implementation code is rejected before storage writes', async () => {
  await fork.request('anvil_setCode', [metadata.implementation, '0x600060005260206000f3'])
  await assert.rejects(installFixtureMetadata(tracked), /runtime identity mismatch/)
  assert.equal(writes().length, 0)
})

test('changed proxy implementation binding is rejected before storage writes', async () => {
  await fork.request('anvil_setStorageAt', [metadata.address, metadata.implementationSlot, word(1)])
  await assert.rejects(installFixtureMetadata(tracked), /runtime identity mismatch/)
  assert.equal(writes().length, 0)
})

test('conflicting metadata or active override is not silently overwritten', async () => {
  await fork.request('anvil_setStorageAt', [metadata.address, word('0x165'), word(2)])
  await assert.rejects(installFixtureMetadata(tracked), /metadata conflicts/)
  assert.equal(writes().length, 0)
})

test('an existing nonzero decimal value is not forced to six', async () => {
  await fork.request('anvil_setStorageAt', [metadata.address, word('0x100'), word(18)])
  await assert.rejects(installFixtureMetadata(tracked), /metadata conflicts/)
  assert.equal(BigInt(await call(metadata.address, '0x313ce567')), 18n)
  assert.equal(writes().length, 0)
})

test('a failed post-install metadata call fails setup', async () => {
  await assert.rejects(installFixtureMetadata((method, params) => method === 'eth_call' ? Promise.resolve('0x') : tracked(method, params)), /call verification failed/)
})
