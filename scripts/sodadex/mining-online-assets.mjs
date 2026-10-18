// Independent DRAFT online-assets phase. It never inherits a completed phase's budget.
import fs from 'node:fs'
import path from 'node:path'
import { decodeEventLog, decodeFunctionData, encodeFunctionData, encodePacked, keccak256, parseAbi, toFunctionSelector, toHex } from 'viem'
import { sourceArtifact, fileSha } from './mining-plan-artifacts.mjs'
import { notSamples } from './mining-plan-nfts.mjs'
import { assertMiningFeeParameters } from './mining-fee-model.mjs'
export const ONLINE_OWNER = '0x6ecf746b078d46391f8C425B150153212F7C0545'
export const ONLINE_PHASE = 'mining-online-assets-1952-v1'
export const ONLINE_PRICE_WEI = 10_000_000_000n
export const ONLINE_FAB_RAW = 9000n * 100_000_000n
const ROOT = '0x512a481c149182d2bb970a739af3326608786cc59316188485ff0d3f340d3a2d'
const ZERO = `0x${'0'.repeat(64)}`
const SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
export const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
export const json = (v) => JSON.stringify(v, (_, value) => typeof value === 'bigint' ? String(value) : value)
export function onlineSources(root) {
  const files = ['mining-online-assets.mjs', 'mining-online-assets-public.mjs', 'simulate-mining-online-assets.mjs',
    'execute-mining-online-assets.mjs', 'mining-plan-rpc.mjs', 'mining-plan-artifacts.mjs', 'mining-plan-nfts.mjs',
    'mining-public-rpc.mjs', 'mining-public-execution.mjs', 'mining-fee-model.mjs', 'mining-reviewed-intent.mjs']
    .map(name => `scripts/sodadex/${name}`)
  files.push('deployments/xlayer-1952/products.json', 'deployments/xlayer-1952/2026-10-17-base-runtime.json')
  return Object.fromEntries(files.map(file => [file, fileSha(fs.readFileSync(path.join(root, file)))]))
}
export function lpAmounts(fab, reserveFab, reserveNative) {
  if (fab <= 0n || reserveFab <= 0n || reserveNative <= 0n) throw new Error('Nonzero test LP reserves required')
  return { fabRaw: String(fab), nativeWei: String((fab * reserveNative + reserveFab - 1n) / reserveFab),
    minimumFabRaw: String(fab), minimumNativeWei: String(fab * reserveNative / reserveFab) }
}
export async function verifyOnlineRoots(plan, root) {
  const d = JSON.parse(fs.readFileSync(path.join(root, 'deployments/xlayer-1952/products.json')))
  if (d.chainId !== 1952 || d.state !== 'ready') throw new Error('Verified 1952 products required')
  const b = await plan.rpc('eth_getBlockByNumber', ['latest', false]), identities = []
  const check = async identity => {
    const code = await plan.rpc('eth_getCode', [identity.address, b.number])
    if (code === '0x' || keccak256(code) !== identity.runtimeKeccak256) throw new Error('Online asset runtime changed')
    identities.push(identity)
  }
  for (const identity of Object.values(d.contracts)) {
    await check(identity)
    if (identity.implementation) {
      const slot = await plan.rpc('eth_getStorageAt', [identity.address, SLOT, b.number])
      if (!same(`0x${slot.slice(-40)}`, identity.implementation.address)) throw new Error('Online asset proxy changed')
      await check(identity.implementation)
    }
    if (identity.beacon) {
      await check(identity.beacon); await check(identity.beacon.implementation)
      if (!same(await plan.call(identity.beacon.address, 'function implementation() view returns(address)', [], b.number), identity.beacon.implementation.address)) throw new Error('Online asset beacon changed')
    }
  }
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'deployments/xlayer-1952/2026-10-17-base-runtime.json')))
  const extra = Object.fromEntries(['transistors', 'transistorBeacon', 'transistorsImplementation'].map(role => {
    const identity = baseline.runtimeChecks.find(row => row.role === role)
    if (!identity?.passed) throw new Error('Missing transistor provenance')
    return [role, identity]
  }))
  for (const identity of Object.values(extra)) {
    const code = await plan.rpc('eth_getCode', [identity.address, b.number])
    if (fileSha(Buffer.from(code.slice(2), 'hex')) !== identity.codeSha256) throw new Error('Transistor runtime changed')
  }
  if (!same(await plan.call(extra.transistorBeacon.address, 'function implementation() view returns(address)', [], b.number), extra.transistorsImplementation.address) ||
      !same(await plan.call(d.contracts.circuits.address, 'function transistors() view returns(address)', [], b.number), extra.transistors.address)) throw new Error('Transistor bindings changed')
  if ((await plan.rpc('eth_getBlockByNumber', [b.number, false])).hash !== b.hash) throw new Error('Root proof reorg')
  return { d, extra, identities, block: { number: b.number, hash: b.hash } }
}
export async function onlineSnapshot(plan, root, artifactRoot, keeper = null, fundingWei = 0n) {
  if (await plan.rpc('eth_chainId') !== '0x7a0') throw new Error('1952 only')
  const roots = await verifyOnlineRoots(plan, root), c = roots.d.contracts, block = roots.block.number
  const mining = sourceArtifact(artifactRoot, 'PodMining'), nft = sourceArtifact(artifactRoot, 'Circuits'), market = sourceArtifact(artifactRoot, 'CircuitMarket')
  const task = await plan.readAbi(c.mining.address, mining.value.abi, 'getTask', [1], block)
  if (!task.active || task.kind !== 0 || task.cycles !== 1 || task.nIn !== 1 || task.nOut !== 1 || task.vectorCount !== 2 ||
      task.vectorsRoot !== ROOT || task.name !== 'SodaDEX TEST NOT' || task.refArea !== 1n || task.refCost !== 1n ||
      !same(task.refCircuits, c.circuits.address) || task.refCircuitId !== 1n) throw new Error('Existing NOT task changed')
  const transistors = roots.extra.transistors.address
  if (await plan.call(transistors, 'function mintPrice() view returns(uint256)', [], block) !== 0n ||
      await plan.call(transistors, 'function protocolFee() view returns(uint256)', [], block) !== 0n ||
      await plan.call(c.circuits.address, 'function TAPEOUT_FEE() view returns(uint256)', [], block) !== 0n ||
      await plan.call(c.mining.address, 'function paused() view returns(bool)', [], block) ||
      await plan.call(c.mining.address, 'function processorMultiplier(address) view returns(uint256)', [c.circuits.address], block) !== 6n) throw new Error('Zero-fee ordinary miner assumptions changed')
  const retail = await plan.call(c.circuitMarket.address, 'function listingView(uint256) view returns(address,address,uint256,uint96,uint16,bool)', [2n], block)
  if (!same(retail[0], ONLINE_OWNER) || !same(retail[1], c.circuits.address) || retail[2] !== 5n || retail[3] !== ONLINE_PRICE_WEI || retail[4] !== 0 || !retail[5]) throw new Error('Reserved retail listing changed')
  const nextId = await plan.call(c.circuits.address, 'function nextId() view returns(uint256)', [], block)
  const nextListingId = await plan.call(c.circuitMarket.address, 'function nextListingId() view returns(uint256)', [], block)
  const pair = await plan.call(c.v2Factory.address, 'function getPair(address,address) view returns(address)', [c.fab.address, c.wrappedNative.address], block)
  if (BigInt(pair) === 0n || !same(await plan.call(c.router.address, 'function WETH() view returns(address)', [], block), c.wrappedNative.address) ||
      !same(await plan.call(c.router.address, 'function factory() view returns(address)', [], block), c.v2Factory.address)) throw new Error('Verified FAB/WOKB venue required')
  const reserves = await plan.call(pair, 'function getReserves() view returns(uint112,uint112,uint32)', [], block)
  const token0 = await plan.call(pair, 'function token0() view returns(address)', [], block)
  const token1 = await plan.call(pair, 'function token1() view returns(address)', [], block)
  if (!same(token0, c.fab.address) || !same(token1, c.wrappedNative.address)) throw new Error('Unexpected test pair assets/order')
  if (fundingWei < 0n || !!keeper !== (fundingWei > 0n) || keeper && (!/^0x[0-9a-f]{40}$/i.test(keeper) || BigInt(keeper) === 0n || same(keeper, ONLINE_OWNER) || await plan.rpc('eth_getCode', [keeper, block]) !== '0x')) throw new Error('Explicit dedicated keeper funding required')
  if (keeper && (same(keeper, await plan.call(c.miningFactory.address, 'function QUOTE_SIGNER() view returns(address)', [], block)) ||
      BigInt(await plan.rpc('eth_getTransactionCount', [keeper, block])) !== 0n || BigInt(await plan.rpc('eth_getBalance', [keeper, block])) !== 0n)) throw new Error('Fresh gas-only keeper must be distinct from S and unfunded')
  const sampleCount = await plan.call(c.mining.address, 'function sampleCountFor(uint32,uint32) view returns(uint32)', [1, 1], block)
  if (!Number.isInteger(sampleCount) || sampleCount <= 0) throw new Error('Invalid mining samples')
  return { schemaVersion: 1, phase: ONLINE_PHASE, chainId: 1952, owner: ONLINE_OWNER, roots,
    sourceSha256: onlineSources(root), artifactSha256: { PodMining: fileSha(fs.readFileSync(mining.file)), Circuits: fileSha(fs.readFileSync(nft.file)), CircuitMarket: fileSha(fs.readFileSync(market.file)) },
    startNonce: String(BigInt(await plan.rpc('eth_getTransactionCount', [ONLINE_OWNER, block]))),
    nextId: String(nextId), nextListingId: String(nextListingId), sampleCount, transistors, pair,
    reserveFabRaw: String(reserves[0]), reserveNativeWei: String(reserves[1]), lp: lpAmounts(ONLINE_FAB_RAW, reserves[0], reserves[1]),
    keeper, keeperFundingWei: String(fundingWei), listingPriceWei: String(ONLINE_PRICE_WEI), reservedRetail: json(retail) }
}
export async function runOnlineAssets(plan, root, artifactRoot, draft) {
  const c = draft.roots.d.contracts, source = sourceArtifact(artifactRoot, 'PodMining').value.abi
  const nft = sourceArtifact(artifactRoot, 'Circuits').value.abi, market = sourceArtifact(artifactRoot, 'CircuitMarket').value.abi
  const write = (label, to, abi, name, args, value = 0n) => plan.send(label, to, encodeFunctionData({ abi, functionName: name, args }), value)
  const event = (receipt, address, abi, name) => {
    for (const log of receipt.logs.filter(l => same(l.address, address))) {
      try { const e = decodeEventLog({ abi, data: log.data, topics: log.topics }); if (e.eventName === name) return e.args } catch {}
    }
    throw new Error(`Missing ${name} event`)
  }
  await plan.write('Online assets: mint two NAND units', draft.transistors, 'function mint(uint256,uint256) payable', [0n, 2n])
  const miners = []
  for (let i = 0; i < 2; i++) {
    const id = BigInt(draft.nextId) + BigInt(i + 1), suffix = String(id)
    const taped = await write(`Online assets: tapeout NFT ${suffix}`, c.circuits.address, nft, 'tapeout', ['0x00000002000002', 1, 1])
    if (event(taped, c.circuits.address, nft, 'TapedOut').circuitId !== id) throw new Error('NFT ID drifted')
    await write(`Online assets: arm NFT ${suffix}`, c.mining.address, source, 'arm', [c.circuits.address, id])
    const key = keccak256(encodePacked(['address', 'uint256'], [c.circuits.address, id]))
    const anchor = await plan.call(c.mining.address, 'function armedAt(bytes32) view returns(uint64)', [key])
    await plan.mineAfterBlock(anchor)
    const header = await plan.rpc('eth_getBlockByNumber', [toHex(anchor), false]), proof = notSamples(header.hash, c.circuits.address, id, draft.sampleCount)
    await write(`Online assets: start NFT ${suffix}`, c.mining.address, source, 'start', [c.circuits.address, id, 1, anchor, proof.inputs, proof.outputs, proof.proofs, ZERO])
    const miner = await plan.readAbi(c.mining.address, source, 'getMiner', [key])
    if (miner.status !== 1 || miner.taskId !== 1 || miner.optimal || miner.bonus !== 0n || miner.boostBps !== 10000 || miner.verifWeight !== 600n || miner.unverWeight !== 0n ||
        !await plan.call(c.farm.address, 'function admissibleMiner(uint256) view returns(bool)', [id])) throw new Error('Miner is not ordinary admissible backing')
    await write(`Online assets: approve only NFT ${suffix}`, c.circuits.address, nft, 'approve', [c.circuitMarket.address, id])
    const listed = await write(`Online assets: list NFT ${suffix}`, c.circuitMarket.address, market, 'list', [c.circuits.address, id, ONLINE_PRICE_WEI])
    const listingId = event(listed, c.circuitMarket.address, market, 'Listed').id
    if (listingId !== BigInt(draft.nextListingId) + BigInt(i + 1)) throw new Error('Listing ID drifted')
    miners.push({ minerId: suffix, listingId: String(listingId), priceWei: draft.listingPriceWei })
  }
  const priorLp = await plan.call(draft.pair, 'function balanceOf(address) view returns(uint256)', [ONLINE_OWNER])
  await plan.write('Online assets: bounded TEST FAB LP approval', c.fab.address, 'function approve(address,uint256) returns(bool)', [c.router.address, BigInt(draft.lp.fabRaw)])
  const deadline = BigInt((await plan.rpc('eth_getBlockByNumber', ['pending', false])).timestamp) + 600n
  await plan.write('Online assets: seed owner FAB/WOKB LP', c.router.address, 'function addLiquidityETH(address,uint256,uint256,uint256,address,uint256) payable returns(uint256,uint256,uint256)',
    [c.fab.address, BigInt(draft.lp.fabRaw), BigInt(draft.lp.minimumFabRaw), BigInt(draft.lp.minimumNativeWei), ONLINE_OWNER, deadline], BigInt(draft.lp.nativeWei))
  if (await plan.call(draft.pair, 'function balanceOf(address) view returns(uint256)', [ONLINE_OWNER]) <= priorLp) throw new Error('Owner LP did not increase')
  if (draft.keeper) await plan.send('Online assets: fund dedicated keeper gas', draft.keeper, '0x', BigInt(draft.keeperFundingWei))
  const retail = await plan.call(c.circuitMarket.address, 'function listingView(uint256) view returns(address,address,uint256,uint96,uint16,bool)', [2n])
  if (json(retail) !== draft.reservedRetail) throw new Error('Reserved user listing was changed')
  plan.result = { completed: true, miners, lpRecipient: ONLINE_OWNER, productionTouched: false, reservedRetailPreserved: true }; plan.save()
}
export async function assertOnlineIntent(plan, row, to, data, value, draft, artifactRoot) {
  if (!same(row.to, to) || BigInt(row.value) !== value) throw new Error('Online intent target/value changed')
  const dynamic = new Set([toFunctionSelector('start(address,uint256,uint32,uint256,bytes[],bytes[],bytes32[][],bytes32)'),
    toFunctionSelector('addLiquidityETH(address,uint256,uint256,uint256,address,uint256)')])
  if (row.data === data && !dynamic.has(data.slice(0, 10))) return
  const abi = [...sourceArtifact(artifactRoot, 'PodMining').value.abi, ...parseAbi(['function addLiquidityETH(address,uint256,uint256,uint256,address,uint256) payable returns(uint256,uint256,uint256)'])]
  const a = decodeFunctionData({ abi, data }), e = decodeFunctionData({ abi, data: row.data })
  if (a.functionName !== e.functionName || encodeFunctionData({ abi, functionName: a.functionName, args: a.args }) !== data) throw new Error('Noncanonical online intent')
  const actual = structuredClone(a.args), expected = e.args
  if (a.functionName === 'start') {
    const anchor = actual[3], latest = BigInt(await plan.rpc('eth_blockNumber'))
    if (anchor >= latest || latest - anchor > 200n || await plan.call(to, 'function armedAt(bytes32) view returns(uint64)', [keccak256(encodePacked(['address', 'uint256'], [actual[0], actual[1]]))]) !== anchor) throw new Error('Invalid real mining anchor')
    const block = await plan.rpc('eth_getBlockByNumber', [toHex(anchor), false]), p = notSamples(block.hash, actual[0], actual[1], draft.sampleCount)
    if (json(actual.slice(4, 7)) !== json([p.inputs, p.outputs, p.proofs])) throw new Error('Invalid real NOT proof')
    for (let i = 3; i <= 6; i++) actual[i] = expected[i]
  } else if (a.functionName === 'addLiquidityETH') {
    const now = BigInt((await plan.rpc('eth_getBlockByNumber', ['pending', false])).timestamp)
    if (actual[5] <= now || actual[5] > now + 600n) throw new Error('LP deadline outside reviewed bound')
    actual[5] = expected[5]
  } else throw new Error('Static online calldata changed')
  if (json(actual) !== json(expected)) throw new Error('Fixed online arguments changed')
}
export { assertMiningFeeParameters }
