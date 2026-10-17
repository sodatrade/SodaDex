// Actual protocol integration. Every write uses the owned Anvil fixture; no external URL is accepted.
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { startOrderFixture } from './fixture.mjs'
const require = createRequire(new URL('../../../standalone/web/package.json', import.meta.url))
const { encodeFunctionData, encodeAbiParameters, parseAbi, zeroAddress, keccak256, hashTypedData } = require('viem')
const {
  fork,
  request,
  maker,
  keeper,
  receiver,
  artifact,
  config,
  protocol,
  pools,
  stable,
  wokb,
  permit2,
  settlement,
  key,
  v3key,
  nativeKey,
  receipts,
  call,
  send,
  balance,
  timestamp,
  ensure,
} = await startOrderFixture()
const tokenAbi = parseAbi([
  'function approve(address,uint256) returns(bool)',
  'function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)',
])
const permitAbi = parseAbi([
  'function allowance(address,address,address) view returns(uint160,uint48,uint48)',
  'function nonceBitmap(address,uint256) view returns(uint256)',
])
const keyType = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
}
try {
  const cases = [
    { protocol: 3, inputToken: wokb, outputToken: stable, amountIn: 10n ** 12n, pool: v3key },
    { protocol: 3, inputToken: stable, outputToken: zeroAddress, amountIn: 10n, pool: v3key },
    { protocol: 4, inputToken: stable, outputToken: zeroAddress, amountIn: 10n, pool: nativeKey },
    { protocol: 4, inputToken: wokb, outputToken: stable, amountIn: 3n * 10n ** 10n, pool: key },
  ]
  const results = []
  let nonce = 100n
  for (const test of cases) {
    const order = {
      chainId: 196n,
      settlement,
      maker: maker.address,
      ...test,
      minAmountOut: 1n,
      receiver,
      nonce: nonce++,
      expiry: (await timestamp()) + 600n,
    }
    await send(
      maker.address,
      order.inputToken,
      encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [permit2, order.amountIn] }),
    )
    const typed = {
      domain: protocol.domain,
      types: protocol.types,
      primaryType: protocol.primaryType,
      message: {
        permitted: { token: order.inputToken, amount: order.amountIn },
        spender: settlement,
        nonce: order.nonce,
        deadline: order.expiry,
        witness: order,
      },
    }
    if (test.protocol === 4 && test.outputToken === stable) {
      const id = keccak256(encodeAbiParameters([keyType], [key]))
      const stateAbi = parseAbi([
        'function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)',
        'function getLiquidity(bytes32) view returns(uint128)',
      ])
      await writeFile(
        new URL('../../../.analysis/orders/pool-state.json', import.meta.url),
        JSON.stringify(
          {
            key,
            id,
            slot: (await call(config.contracts.v4StateView, stateAbi, 'getSlot0', [id])).map(String),
            liquidity: String(await call(config.contracts.v4StateView, stateAbi, 'getLiquidity', [id])),
          },
          null,
          2,
        ),
      )
    }
    const signature = await maker.signTypedData(typed)
    ensure(
      (await call(settlement, artifact.abi, 'orderDigest', [order])) === hashTypedData(typed),
      'EIP-712 digest mismatch',
    )
    const inputBefore = await balance(order.inputToken, maker.address),
      outputBefore = await balance(order.outputToken, receiver)
    const execute = encodeFunctionData({ abi: artifact.abi, functionName: 'execute', args: [order, signature] })
    await send(keeper, settlement, execute)
    const outputAfter = await balance(order.outputToken, receiver)
    ensure(
      inputBefore - (await balance(order.inputToken, maker.address)) === order.amountIn,
      'Wrong actual maker spend',
    )
    ensure(outputAfter - outputBefore >= order.minAmountOut, 'Signed receiver did not receive minimum')
    ensure(
      (await call(settlement, artifact.abi, 'nonceStatus', [maker.address, order.nonce])) === 2,
      'Missing filled state',
    )
    ensure(
      (await balance(order.inputToken, settlement)) === 0n && (await balance(order.outputToken, settlement)) === 0n,
      'Unexpected settlement custody',
    )
    ensure(
      (await call(order.inputToken, tokenAbi, 'allowance', [settlement, permit2])) === 0n,
      'ERC20 settlement approval remained',
    )
    ensure(
      (
        await call(permit2, permitAbi, 'allowance', [settlement, order.inputToken, config.contracts.universalRouter])
      )[0] === 0n,
      'Permit2 settlement approval remained',
    )
    await send(keeper, settlement, execute, 0n, false)
    results.push({
      protocol: test.protocol,
      input: test.inputToken,
      output: test.outputToken,
      amountIn: String(order.amountIn),
      actualReceiverOutput: String(outputAfter - outputBefore),
      replayRejected: true,
    })
  }
  const order = {
    chainId: 196n,
    settlement,
    maker: maker.address,
    protocol: 4,
    inputToken: stable,
    outputToken: zeroAddress,
    amountIn: 1n,
    minAmountOut: 10n ** 25n,
    receiver,
    nonce: nonce++,
    expiry: (await timestamp()) + 600n,
    pool: nativeKey,
  }
  await send(maker.address, stable, encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [permit2, 1n] }))
  const typed = {
    domain: protocol.domain,
    types: protocol.types,
    primaryType: protocol.primaryType,
    message: {
      permitted: { token: stable, amount: 1n },
      spender: settlement,
      nonce: order.nonce,
      deadline: order.expiry,
      witness: order,
    },
  }
  const signature = await maker.signTypedData(typed),
    execute = encodeFunctionData({ abi: artifact.abi, functionName: 'execute', args: [order, signature] })
  const before = await balance(stable, maker.address),
    bitmap = await call(permit2, permitAbi, 'nonceBitmap', [maker.address, 0n])
  await send(keeper, settlement, execute, 0n, false)
  ensure((await balance(stable, maker.address)) === before, 'Failed limit consumed maker input')
  ensure(
    (await call(permit2, permitAbi, 'nonceBitmap', [maker.address, 0n])) === bitmap,
    'Failed limit consumed Permit2 nonce',
  )
  ensure(
    (await call(settlement, artifact.abi, 'nonceStatus', [maker.address, order.nonce])) === 0,
    'Failed limit consumed local nonce',
  )
  await send(
    maker.address,
    settlement,
    encodeFunctionData({ abi: artifact.abi, functionName: 'cancel', args: [order.nonce] }),
  )
  await send(keeper, settlement, execute, 0n, false)
  ensure(
    (await call(settlement, artifact.abi, 'nonceStatus', [maker.address, order.nonce])) === 1,
    'Cancellation not terminal',
  )
  const evidence = {
    mode: 'owned-anvil-only',
    chainId: 196,
    settlement,
    actualContracts: config.contracts,
    permit2,
    fullFillCases: results,
    failedLimitRollsBack: true,
    cancellationPreventsExecution: true,
    receiptCount: receipts.length,
    receipts,
  }
  await writeFile(
    new URL('../../../.analysis/orders/integration-evidence.json', import.meta.url),
    JSON.stringify(evidence, null, 2) + '\n',
  )
  process.stdout.write(
    JSON.stringify({
      mode: evidence.mode,
      settlement,
      cases: results,
      failedLimitRollsBack: true,
      cancellationPreventsExecution: true,
      receiptCount: receipts.length,
    }) + '\n',
  )
} finally {
  fork.stop()
}
