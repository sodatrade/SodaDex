// Real contract execution on an owned Anvil instance only. This script never reads an existing wallet.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { encodeFunctionData, parseAbi, zeroAddress } from 'viem'
import { orderTypedData } from '../../order-types.ts'
import { ViemOrderChain } from '../src/chain.ts'
import { ChainFailure } from '../src/chain-types.ts'
import { FIXED, validateConfig } from '../src/config.ts'
import { OrdersKeeper } from '../src/keeper.ts'
import { createOrdersServer } from '../src/server.ts'
import { OrdersService } from '../src/service.ts'
import { OrderStore } from '../src/store.ts'

const fixtureModule = process.env.SODADEX_ORDER_FIXTURE_MODULE
  ? pathToFileURL(resolve(process.env.SODADEX_ORDER_FIXTURE_MODULE))
  : new URL('../../../contracts/sodadex-orders/test/fixture.mjs', import.meta.url)
const { startOrderFixture } = await import(fixtureModule.href)
const fixture = await startOrderFixture()
const folder = mkdtempSync(join(tmpdir(), 'sodadex-order-integration-'))
const databasePath = join(folder, 'orders.sqlite')
const config = validateConfig({ settlement: fixture.settlement, rpcUrl: `http://127.0.0.1:${fixture.fork.port}`, publicOrigin: 'http://127.0.0.1:3031', databasePath, localTest: true, executionEnabled: true, gasBudgetWei: 10n ** 16n })
const chain = new ViemOrderChain(config)
const tokenAbi = parseAbi(['function approve(address,uint256) returns(bool)'])
let store = new OrderStore(databasePath), service = new OrdersService(config, store, chain)
let signed = 0
const signer = { address: fixture.keeperAccount.address, signTransaction: async plan => { signed++; return fixture.keeperAccount.signTransaction({ ...plan, type: 'legacy' }) } }
let keeper = new OrdersKeeper(config, store, chain, signer)
const results = []
let nonce = 1000n
const makeOrder = async (fields) => ({ chainId: 196, settlement: fixture.settlement, maker: fixture.maker.address, receiver: fixture.receiver, minAmountOut: '1', nonce: String(nonce++), expiry: String((await fixture.timestamp()) + 600n), ...fields })
const approve = order => fixture.send(fixture.maker.address, order.inputToken, encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [fixture.permit2, BigInt(order.amountIn)] }))
async function http(action) {
  const server = createOrdersServer(service)
  await new Promise((resolveListening, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListening) })
  try { return await action(`http://127.0.0.1:${server.address().port}`) }
  finally { await new Promise((resolveClosed, reject) => server.close(error => error ? reject(error) : resolveClosed())) }
}
async function accepted(order, signature) {
  return http(async url => {
    const response = await fetch(`${url}/v1/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order, signature }) })
    const data = await response.json()
    assert.equal(response.status, 201, data.code)
    assert.ok(!JSON.stringify(data).includes(signature), 'HTTP response leaked a signature')
    return data.order
  })
}
try {
  assert.equal(await chain.ready(), true)
  const cases = [
    { protocol: 3, inputToken: fixture.wokb, outputToken: fixture.stable, amountIn: String(10n ** 12n), pool: fixture.v3key },
    { protocol: 3, inputToken: fixture.stable, outputToken: zeroAddress, amountIn: '10', pool: fixture.v3key },
    { protocol: 4, inputToken: fixture.stable, outputToken: zeroAddress, amountIn: '10', pool: fixture.nativeKey },
    { protocol: 4, inputToken: fixture.wokb, outputToken: fixture.stable, amountIn: String(3n * 10n ** 10n), pool: fixture.key },
  ]
  for (const [index, fields] of cases.entries()) {
    const order = await makeOrder(fields)
    await approve(order)
    const signature = await fixture.maker.signTypedData(orderTypedData(order, FIXED.permit2))
    const acceptedOrder = await accepted(order, signature)
    const beforeInput = await fixture.balance(order.inputToken, order.maker), beforeOutput = await fixture.balance(order.outputToken, order.receiver)
    const countBefore = signed
    if (index === 0) {
      // The node accepts/mines the transaction, while the caller loses its broadcast response.
      // Reopen the database and recover the same hash without asking the signer again.
      class AmbiguousChain extends ViemOrderChain {
        async broadcast(raw) { await super.broadcast(raw); throw new ChainFailure('unavailable') }
      }
      const ambiguous = new AmbiguousChain(config)
      await new OrdersKeeper(config, store, ambiguous, signer).runOnce()
      assert.equal(store.get(acceptedOrder.id).reason, 'broadcast_unknown')
      assert.equal(store.executions().length, 1)
      const preparedHash = store.get(acceptedOrder.id).txHash
      store.close()
      store = new OrderStore(databasePath)
      service = new OrdersService(config, store, chain)
      keeper = new OrdersKeeper(config, store, chain, signer)
      await keeper.runOnce()
      assert.equal(store.get(acceptedOrder.id).txHash, preparedHash)
    } else {
      await keeper.runOnce()
      await keeper.runOnce()
    }
    const current = await service.get(acceptedOrder.id)
    assert.equal(current.status, 'filled')
    assert.equal(signed - countBefore, 1)
    const received = (await fixture.balance(order.outputToken, order.receiver)) - beforeOutput
    assert.ok(received >= BigInt(order.minAmountOut))
    assert.equal(beforeInput - await fixture.balance(order.inputToken, order.maker), BigInt(order.amountIn))
    assert.equal((await chain.observe(order)).nonceStatus, 2)
    const receipt = await chain.receipt(current.txHash, order)
    assert.equal(receipt.filled, true)
    assert.equal(receipt.succeeded, true)
    await http(async url => {
      const repeated = await fetch(`${url}/v1/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order, signature }) })
      assert.equal(repeated.status, 200)
      assert.equal((await repeated.json()).order.status, 'filled')
      const read = await (await fetch(`${url}/v1/orders/${current.id}`)).text()
      assert.ok(!read.includes(signature) && !read.includes('rawTransaction'))
    })
    results.push({ protocol: fields.protocol, inputToken: fields.inputToken, outputToken: fields.outputToken, amountIn: fields.amountIn, minAmountOut: '1', received: String(received), status: current.status, txHash: current.txHash, gasCostWei: String(receipt.gasCostWei), restartRecovered: index === 0 })
  }
  // An unmarketable signed minimum stays open and consumes neither local nor Permit2 nonce.
  const expensive = await makeOrder({ ...cases[0], minAmountOut: String(2n ** 127n) })
  await approve(expensive)
  const open = await accepted(expensive, await fixture.maker.signTypedData(orderTypedData(expensive, FIXED.permit2)))
  const signedBeforeFailure = signed
  await keeper.runOnce()
  assert.equal(signed, signedBeforeFailure)
  assert.equal(store.get(open.id).status, 'open')
  assert.equal(store.get(open.id).reason, 'awaiting_price')
  const unfilledState = await chain.observe(expensive)
  assert.equal(unfilledState.nonceStatus, 0)
  assert.equal(unfilledState.permitNonceUsed, false)
  // HTTP cannot cancel: only the actual maker's settlement transaction changes the authoritative state.
  await fixture.send(fixture.maker.address, fixture.settlement, encodeFunctionData({ abi: fixture.artifact.abi, functionName: 'cancel', args: [BigInt(expensive.nonce)] }))
  assert.equal((await service.get(open.id)).status, 'cancelled')
  const pausedConfig = { ...config, executionEnabled: false }, paused = new OrdersService(pausedConfig, store, chain)
  assert.equal((await paused.status()).reason, 'EXECUTION_PAUSED')
  assert.equal((await paused.status()).settlement, fixture.settlement)
  assert.equal((await paused.get(open.id)).status, 'cancelled')
  const nextWhilePaused = await makeOrder(cases[0])
  await assert.rejects(paused.accept({ order: nextWhilePaused, signature: await fixture.maker.signTypedData(orderTypedData(nextWhilePaused, FIXED.permit2)) }), { code: 'EXECUTION_PAUSED' })
  assert.equal((await paused.accept({ order: expensive, signature: await fixture.maker.signTypedData(orderTypedData(expensive, FIXED.permit2)) })).created, false)
  await new OrdersKeeper(pausedConfig, store, chain, signer).runOnce()
  assert.equal(signed, signedBeforeFailure)
  const expiring = await makeOrder({ ...cases[0], expiry: String((await fixture.timestamp()) + 2n) })
  const expires = await accepted(expiring, await fixture.maker.signTypedData(orderTypedData(expiring, FIXED.permit2)))
  await fixture.request('evm_setNextBlockTimestamp', [Number(BigInt(expiring.expiry))])
  await fixture.request('evm_mine', [])
  assert.equal((await service.get(expires.id)).status, 'expired')
  assert.equal(signed, signedBeforeFailure)
  assert.equal(statSync(databasePath).mode & 0o077, 0)
  const proof = { schemaVersion: 1, mode: 'owned-anvil-only', chainId: 196, fixtureTransactions: fixture.receipts.length, signedExecutions: signed, results, failedMinimumStayedOpen: true, nonceUnchangedOnFailure: true, makerCancellationObserved: true, chainExpiryObserved: true, executionPausePreservesReads: true, idempotentTerminalSubmission: true, httpSecretsRedacted: true, databasePrivate: true, gasCommittedWei: String(store.gasCommitted()), gasBudgetWei: String(config.gasBudgetWei) }
  if (process.env.SODADEX_ORDER_SERVICE_PROOF) writeFileSync(resolve(process.env.SODADEX_ORDER_SERVICE_PROOF), JSON.stringify(proof, null, 2))
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`)
} finally {
  store.close()
  fixture.fork.stop()
  rmSync(folder, { recursive: true, force: true })
}
