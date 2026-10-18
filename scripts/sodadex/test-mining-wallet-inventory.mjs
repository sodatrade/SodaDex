import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ONLINE_OWNER } from './mining-online-assets.mjs'
import { INVENTORY_RECIPIENT, INVENTORY_FAB_RAW, assertInventoryBoundary, runWalletInventory } from './mining-wallet-inventory.mjs'
import { INVENTORY_LOOPBACK, InventoryLoopbackPlan } from './simulate-mining-wallet-inventory.mjs'

const snapshot = { chainId: 1952, owner: ONLINE_OWNER, startNonce: '143', nextId: '7', nextListingId: '4' }
const check = value => assertInventoryBoundary(value, INVENTORY_RECIPIENT, '0x', INVENTORY_FAB_RAW, 3n, 4)
test('only the exact reviewed chain, sender nonce, NFT and listing boundary can prepare inventory', () => {
  assert.doesNotThrow(() => check(snapshot))
  for (const change of [{ chainId: 196 }, { owner: INVENTORY_RECIPIENT }, { startNonce: '144' }, { nextId: '8' }, { nextListingId: '5' }]) {
    assert.throws(() => check({ ...snapshot, ...change }), /boundary/)
  }
})
test('wallet preparation rejects another recipient, self funding, contract account and insufficient TEST-FAB', () => {
  for (const [recipient, code, balance] of [[ONLINE_OWNER, '0x', INVENTORY_FAB_RAW],
    ['0x1111111111111111111111111111111111111111', '0x', INVENTORY_FAB_RAW],
    [INVENTORY_RECIPIENT, '0x1234', INVENTORY_FAB_RAW], [INVENTORY_RECIPIENT, '0x', INVENTORY_FAB_RAW - 1n]]) {
    assert.throws(() => assertInventoryBoundary(snapshot, recipient, code, balance, 3n, 4))
  }
})
test('inventory does not silently prepare more miners when the fixed farm capacity changes', () => {
  for (const [count, capacity] of [[4n, 4], [2n, 4], [3n, 8]]) {
    assert.throws(() => assertInventoryBoundary(snapshot, INVENTORY_RECIPIENT, '0x', INVENTORY_FAB_RAW, count, capacity), /free shared-farm slot/)
  }
})
test('local transport cannot submit anything before a verified fresh Anvil1952 fork', async () => {
  const calls = [], plan = new InventoryLoopbackPlan('/tmp/unused-inventory-test.json', 1n, async url => { calls.push(url); throw Error('Unexpected network') })
  for (const method of ['eth_sendTransaction', 'evm_mine', 'anvil_impersonateAccount']) await assert.rejects(() => plan.rpc(method), /ownership/)
  await assert.rejects(() => plan.rpc('eth_sendRawTransaction'), /not allowed/)
  assert.equal(calls.length, 0)
})
test('a wrong chain is rejected and the sole contacted URL is literal loopback8956', async () => {
  const calls = [], plan = new InventoryLoopbackPlan('/tmp/unused-inventory-test.json', 1n, async (url, init) => {
    calls.push(url); const r = JSON.parse(init.body); return Response.json({ jsonrpc: '2.0', id: r.id, result: '0xc4' })
  })
  await assert.rejects(() => plan.start(), /Anvil1952/)
  assert.deepEqual(calls, [INVENTORY_LOOPBACK]); assert.equal(plan.ownedForkVerified, undefined)
})
test('advanced forks and a changed owner nonce fail before impersonation or output creation', async () => {
  for (const variant of ['advanced', 'nonce']) {
    const calls = [], output = path.join(os.tmpdir(), `inventory-must-not-create-${process.pid}-${variant}.json`)
    const plan = new InventoryLoopbackPlan(output, 1n, async (url, init) => {
      assert.equal(url, INVENTORY_LOOPBACK); const r = JSON.parse(init.body); calls.push(r.method)
      const values = { eth_chainId: '0x7a0', web3_clientVersion: 'anvil/v1', anvil_nodeInfo: { forkConfig: { forkBlockNumber: 100 } },
        eth_blockNumber: variant === 'advanced' ? '0x65' : '0x64', eth_getTransactionCount: '0x90' }
      return Response.json({ jsonrpc: '2.0', id: r.id, result: values[r.method] })
    })
    await assert.rejects(() => plan.start(), variant === 'advanced' ? /Fresh inventory/ : /nonce/)
    assert.ok(!calls.includes('anvil_impersonateAccount')); assert.ok(!fs.existsSync(output))
  }
})
test('a write transport failure is never retried, and redirect following is disabled', async () => {
  let attempts = 0
  const plan = new InventoryLoopbackPlan('/tmp/unused-inventory-test.json', 1n, async (url, init) => {
    assert.equal(url, INVENTORY_LOOPBACK); assert.equal(init.redirect, 'manual'); attempts++; throw Error('timeout')
  }, async () => {})
  plan.ownedForkVerified = true
  await assert.rejects(() => plan.rpc('eth_sendTransaction', [{}]), /timeout/)
  assert.equal(attempts, 1)
})
test('changed payout or nonzero native principal cannot reach any write or artifact loader', async () => {
  for (const change of [{ recipient: ONLINE_OWNER }, { transferFabRaw: '1' }, { nativePrincipalWei: '1' }, { listingId: '6' }]) {
    await assert.rejects(() => runWalletInventory({}, '/does-not-exist', {
      phase: 'mining-wallet-inventory-1952-v1', owner: ONLINE_OWNER, recipient: INVENTORY_RECIPIENT,
      minerId: '8', listingId: '5', transferFabRaw: String(INVENTORY_FAB_RAW), listingPriceWei: '10000000000', nativePrincipalWei: '0', ...change,
    }), /Fixed inventory intent/)
  }
})
