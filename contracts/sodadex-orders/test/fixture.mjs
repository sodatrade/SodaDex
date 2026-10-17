// Owned Anvil only: actual SodaDEX Router, V3/V4, Permit2 and assets from the rehearsal snapshot.
// Ephemeral in-memory test keys are never printed or saved. No URL option or upstream broadcast path exists.
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { startLiquidityFork } from '../../../standalone/web/tests/liquidityForkFixture.ts'
const require = createRequire(new URL('../../../standalone/web/package.json', import.meta.url))
const {
  encodeFunctionData,
  encodeAbiParameters,
  decodeFunctionResult,
  parseAbi,
  toHex,
  pad,
  zeroAddress,
  keccak256,
  hashTypedData,
} = require('viem')
const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts')
const readJSON = async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'))
const artifact = await readJSON('../../../.analysis/orders/settlement.json')
const config = await readJSON('../../../deployments/xlayer-test/active.json')
const protocol = await readJSON('../protocol.json')
const pools = await readJSON('../../../deployments/xlayer-test/pools.json')

// Public, pinned RPC state. Never replace the real fee model with an always-zero mock.
export async function installFeeOracleFixture(request, fixturePath = process.env.SODADEX_ORDER_FEE_ORACLE_FILE) {
  if (!fixturePath) throw Error('SODADEX_ORDER_FEE_ORACLE_FILE required for the reviewed fee model')
  const bytes = await readFile(fixturePath)
  const sha = value => createHash('sha256').update(value).digest('hex')
  if (sha(bytes) !== '80a0584aba839853de9d595c61cd4304a95e99c25376ac8395cfb324b7d2ff74') throw Error('Fee oracle fixture changed')
  const fixture = JSON.parse(bytes.toString('utf8'))
  if (fixture.chainId !== 196 || fixture.blockNumber !== 73438680 || fixture.blockHash !== '0xf56b34f2476f626fc70b8b8a772c4491222bdaa6458bd57bec81dcc1e22f5c65') throw Error('Unreviewed fee oracle source block')
  const expected = {
    '0x420000000000000000000000000000000000000f': '30ccc4ce49c00fae11d7118fc244f29a13788fb32cd4022ee69acc2f15c0e2f5',
    '0x4f1db3c6abd250ba86e0928471a8f7db3afd88f1': '7e49db5c1d54bab9a75a387dc972d4fb1c3c78f3fbf31336a9d8413d6d125cc3',
    '0x4200000000000000000000000000000000000015': '30ccc4ce49c00fae11d7118fc244f29a13788fb32cd4022ee69acc2f15c0e2f5',
    '0x1160d963acd3799e820b75809cdba75bcef8bf74': 'eae605b5a2953f2075aec2473e3c8e754c1cccfc71ef1341754a170596f60150',
  }
  if (Object.keys(fixture.accounts).length !== Object.keys(expected).length) throw Error('Unexpected fee fixture account')
  for (const [address, codeSha] of Object.entries(expected)) {
    const account = fixture.accounts[address]
    if (!account || sha(Buffer.from(account.code.slice(2), 'hex')) !== codeSha) throw Error('Unreviewed oracle runtime')
    await request('anvil_setCode', [address, account.code])
    for (const [slot, value] of Object.entries(account.storage)) await request('anvil_setStorageAt', [address, pad(toHex(BigInt(slot)), { size: 32 }), value])
  }
  const abi = parseAbi(['function isFjord() view returns(bool)', 'function isIsthmus() view returns(bool)', 'function getL1FeeUpperBound(uint256) view returns(uint256)', 'function getOperatorFee(uint256) view returns(uint256)'])
  for (const [functionName, args, expectedValue] of [['isFjord', [], true], ['isIsthmus', [], true], ['getL1FeeUpperBound', [4096n], 0n], ['getOperatorFee', [1000000n], 0n]]) {
    const data = encodeFunctionData({ abi, functionName, args })
    const result = decodeFunctionResult({ abi, functionName, data: await request('eth_call', [{ to: '0x420000000000000000000000000000000000000f', data }, 'latest']) })
    if (result !== expectedValue) throw Error('Installed oracle fixture proof failed')
  }
  return { blockNumber: fixture.blockNumber, blockHash: fixture.blockHash, sha256: sha(bytes) }
}
export async function startOrderFixture(options = {}) {
  const fork = await startLiquidityFork({
    fixturePath: options.fixturePath ?? process.env.SODADEX_LP_FORK_STATE,
    stateViewCodePath: options.stateViewCodePath ?? process.env.SODADEX_LP_STATEVIEW_CODE,
  })
  const maker = privateKeyToAccount(generatePrivateKey()),
    keeperAccount = privateKeyToAccount(generatePrivateKey()),
    keeper = keeperAccount.address,
    receiver = privateKeyToAccount(generatePrivateKey()).address
  const { request } = fork
  const receipts = []
  const ensure = (value, label) => {
    if (!value) throw Error(label)
  }
  const tokenAbi = parseAbi([
    'function approve(address,uint256) returns(bool)',
    'function transfer(address,uint256) returns(bool)',
    'function balanceOf(address) view returns(uint256)',
    'function allowance(address,address) view returns(uint256)',
    'function deposit() payable',
  ])
  const permitAbi = parseAbi([
    'function approve(address,address,uint160,uint48)',
    'function allowance(address,address,address) view returns(uint160,uint48,uint48)',
    'function nonceBitmap(address,uint256) view returns(uint256)',
  ])
  const posmAbi = parseAbi([
    'function multicall(bytes[]) payable returns(bytes[])',
    'function modifyLiquidities(bytes,uint256) payable',
    'function initializePool((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint160) payable returns(int24)',
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
  async function call(to, abi, name, args = []) {
    return decodeFunctionResult({
      abi,
      functionName: name,
      data: await request('eth_call', [{ to, data: encodeFunctionData({ abi, functionName: name, args }) }, 'latest']),
    })
  }
  async function send(from, to, data, value = 0n, success = true) {
    const hash = await request('eth_sendTransaction', [
      { from, ...(to ? { to } : {}), data, value: toHex(value), gas: '0x7a1200' },
    ])
    let receipt
    for (let n = 0; n < 300; n++) {
      receipt = await request('eth_getTransactionReceipt', [hash])
      if (receipt) break
      await new Promise((r) => setTimeout(r, 10))
    }
    ensure(receipt, 'Local receipt missing')
    if (receipt.status !== (success ? '0x1' : '0x0')) {
      const trace = await request('debug_traceTransaction', [hash, { tracer: 'callTracer' }])
      const failures = []
      function visit(x) {
        if (x.error || x.to?.toLowerCase() === config.contracts.v4PoolManager.toLowerCase())
          failures.push({ to: x.to, selector: x.input?.slice(0, 10), error: x.error, output: x.output?.slice(0, 514) })
        for (const c of x.calls ?? []) visit(c)
      }
      visit(trace)
      await writeFile(
        new URL('../../../.analysis/orders/integration-failure.json', import.meta.url),
        JSON.stringify({ receiptNumber: receipts.length, failures }, null, 2),
      )
      throw Error('Unexpected local transaction status; sanitized trace retained')
    }
    receipts.push({
      hash,
      from,
      to: receipt.to,
      contractAddress: receipt.contractAddress,
      status: receipt.status,
      gasUsed: receipt.gasUsed,
    })
    return receipt
  }
  const timestamp = async () => BigInt((await request('eth_getBlockByNumber', ['latest', false])).timestamp)
  const balance = (token, address) =>
    token === zeroAddress
      ? request('eth_getBalance', [address, 'latest']).then(BigInt)
      : call(token, tokenAbi, 'balanceOf', [address])
  function sqrt(n) {
    if (n < 2n) return n
    let x = n,
      y = (x + 1n) / 2n
    while (y < x) {
      x = y
      y = (x + n / x) / 2n
    }
    return x
  }
  try {
    await installFeeOracleFixture(request, options.feeOraclePath)
    for (const address of [maker.address, keeper]) await request('anvil_setBalance', [address, '0x56bc75e2d63100000'])
    const deployed = await send(maker.address, null, '0x' + artifact.evm.bytecode.object)
    const settlement = deployed.contractAddress
    ensure((await call(settlement, artifact.abi, 'CHAIN_ID')) === 196n, 'Settlement chain mismatch')
    const stable = pools.stable.address,
      wokb = config.wrappedNative,
      permit2 = config.permit2
    await send(
      config.owner,
      stable,
      encodeFunctionData({ abi: tokenAbi, functionName: 'transfer', args: [maker.address, 180n] }),
    )
    await send(maker.address, wokb, encodeFunctionData({ abi: tokenAbi, functionName: 'deposit' }), 10n ** 15n)
    // Build a real hookless WOKB/USDt0 v4 pool for the ERC20-output case, using explicit liquidity actions.
    const [c0, c1] = BigInt(stable) < BigInt(wokb) ? [stable, wokb] : [wokb, stable]
    const key = { currency0: c0, currency1: c1, fee: 0, tickSpacing: 1, hooks: zeroAddress }
    const price = sqrt(8n * 10n ** 9n * (1n << 192n)),
      liquidity = 10n ** 7n
    const max0 = 112n,
      max1 = 900_000_000_000n,
      deadline = (await timestamp()) + 600n
    for (const [token, amount] of [
      [c0, max0],
      [c1, max1],
    ]) {
      await send(
        maker.address,
        token,
        encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [permit2, amount] }),
      )
      await send(
        maker.address,
        permit2,
        encodeFunctionData({
          abi: permitAbi,
          functionName: 'approve',
          args: [token, config.contracts.v4PositionManager, amount, Number(deadline)],
        }),
      )
    }
    const mint = encodeAbiParameters(
      [
        keyType,
        { type: 'int24' },
        { type: 'int24' },
        { type: 'uint256' },
        { type: 'uint128' },
        { type: 'uint128' },
        { type: 'address' },
        { type: 'bytes' },
      ],
      [key, -887272, 887272, liquidity, max0, max1, maker.address, '0x'],
    )
    const settle = encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [c0, c1])
    const unlock = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], ['0x020d', [mint, settle]])
    const initialization = encodeFunctionData({ abi: posmAbi, functionName: 'initializePool', args: [key, price] })
    const modify = encodeFunctionData({ abi: posmAbi, functionName: 'modifyLiquidities', args: [unlock, deadline] })
    await send(
      maker.address,
      config.contracts.v4PositionManager,
      encodeFunctionData({ abi: posmAbi, functionName: 'multicall', args: [[initialization, modify]] }),
    )
    const v3key = { currency0: stable, currency1: wokb, fee: 100, tickSpacing: 1, hooks: zeroAddress }
    const nativeKey = { currency0: zeroAddress, currency1: stable, fee: 0, tickSpacing: 1, hooks: zeroAddress }

    const typedData = (order) => ({
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
    })
    return {
      fork,
      request,
      maker,
      keeperAccount,
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
      typedData,
    }
  } catch (cause) {
    fork.stop()
    throw cause
  }
}
