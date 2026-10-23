// A separate inventory-only phase. This module has no wallet or public-write adapter.
import fs from 'node:fs'
import path from 'node:path'
import { decodeEventLog, encodeFunctionData, encodePacked, keccak256, toHex } from 'viem'
import { ONLINE_OWNER, ONLINE_PRICE_WEI, onlineSnapshot, json, same } from './mining-online-assets.mjs'
import { sourceArtifact, fileSha } from './mining-plan-artifacts.mjs'
import { notSamples } from './mining-plan-nfts.mjs'

export const INVENTORY_PHASE = 'mining-wallet-inventory-1952-v1'
export const INVENTORY_RECIPIENT = '0xe57f88c05810a9ad2b27f216665260c2d9f2b2da'
export const INVENTORY_FAB_RAW = 6000n * 100_000_000n
export const INVENTORY_START_NONCE = 143n
const ZERO = `0x${'0'.repeat(64)}`
function inventoryEvent(receipt, address, abi, name) {
  for (const log of receipt.logs.filter(row => same(row.address, address))) {
    try { const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }); if (decoded.eventName === name) return decoded.args } catch { /* Other events belong to the same receipt. */ }
  }
  throw new Error(`Missing inventory ${name} event`)
}

export function assertInventoryBoundary(snapshot, recipient, recipientCode, availableFab, farmCount, farmCapacity) {
  if (snapshot.chainId !== 1952 || !same(snapshot.owner, ONLINE_OWNER) || snapshot.startNonce !== String(INVENTORY_START_NONCE) ||
      snapshot.nextId !== '7' || snapshot.nextListingId !== '4') throw new Error('Inventory phase boundary changed; review a new plan')
  if (!/^0x[0-9a-f]{40}$/i.test(recipient) || !same(recipient, INVENTORY_RECIPIENT) || same(recipient, ONLINE_OWNER) ||
      BigInt(recipient) === 0n || recipientCode !== '0x') throw new Error('Exact non-owner EOA recipient required')
  if (availableFab < INVENTORY_FAB_RAW) throw new Error('Insufficient owner TEST-FAB for fixed wallet preparation')
  if (farmCount !== 3n || farmCapacity !== 4) throw new Error('Expected exactly one free shared-farm slot')
}

export function inventorySources(root) {
  return Object.fromEntries(['mining-wallet-inventory.mjs', 'simulate-mining-wallet-inventory.mjs',
    'mining-online-assets.mjs', 'mining-plan-rpc.mjs', 'mining-plan-artifacts.mjs', 'mining-plan-nfts.mjs', 'mining-fee-model.mjs']
    .map(name => [`scripts/sodadex/${name}`, fileSha(fs.readFileSync(path.join(root, 'scripts/sodadex', name)))]))
}

export async function inventorySnapshot(plan, root, artifactRoot) {
  const snapshot = await onlineSnapshot(plan, root, artifactRoot), block = snapshot.roots.block.number
  const c = snapshot.roots.d.contracts
  const [recipientCode, ownerFab, recipientFab, farmCount, farmCapacity] = await Promise.all([
    plan.rpc('eth_getCode', [INVENTORY_RECIPIENT, block]),
    plan.call(c.fab.address, 'function balanceOf(address) view returns(uint256)', [ONLINE_OWNER], block),
    plan.call(c.fab.address, 'function balanceOf(address) view returns(uint256)', [INVENTORY_RECIPIENT], block),
    plan.call(c.farm.address, 'function minerCount() view returns(uint256)', [], block),
    plan.call(c.farm.address, 'function MAX_MINERS() view returns(uint16)', [], block),
  ])
  assertInventoryBoundary(snapshot, INVENTORY_RECIPIENT, recipientCode, ownerFab, farmCount, farmCapacity)
  if ((await plan.rpc('eth_getBlockByNumber', [block, false])).hash !== snapshot.roots.block.hash) throw new Error('Inventory boundary reorg')
  return { phase: INVENTORY_PHASE, chainId: 1952, owner: ONLINE_OWNER, startNonce: snapshot.startNonce,
    roots: snapshot.roots, transistors: snapshot.transistors, sampleCount: snapshot.sampleCount,
    minerId: '8', listingId: '5', listingPriceWei: String(ONLINE_PRICE_WEI),
    reservedRetail: snapshot.reservedRetail, recipient: INVENTORY_RECIPIENT, recipientCode,
    transferFabRaw: String(INVENTORY_FAB_RAW), ownerFabBeforeRaw: String(ownerFab), recipientFabBeforeRaw: String(recipientFab),
    nativePrincipalWei: '0', keeperFundingWei: '0', extraLiquidityFabRaw: '0',
    farmCount: String(farmCount), farmCapacity, sourceSha256: inventorySources(root) }
}

export async function runWalletInventory(plan, artifactRoot, draft) {
  if (draft.phase !== INVENTORY_PHASE || !same(draft.owner, ONLINE_OWNER) || !same(draft.recipient, INVENTORY_RECIPIENT) ||
      draft.minerId !== '8' || draft.listingId !== '5' || draft.transferFabRaw !== String(INVENTORY_FAB_RAW) ||
      draft.listingPriceWei !== String(ONLINE_PRICE_WEI) || draft.nativePrincipalWei !== '0') throw new Error('Fixed inventory intent changed')
  const c = draft.roots.d.contracts, id = BigInt(draft.minerId)
  const nft = sourceArtifact(artifactRoot, 'Circuits').value.abi
  const mining = sourceArtifact(artifactRoot, 'PodMining').value.abi
  const market = sourceArtifact(artifactRoot, 'CircuitMarket').value.abi
  const write = (label, to, abi, name, args) => plan.send(label, to, encodeFunctionData({ abi, functionName: name, args }), 0n)
  await plan.write('Wallet inventory: mint one NAND', draft.transistors, 'function mint(uint256,uint256) payable', [0n, 1n])
  const taped = await write('Wallet inventory: tapeout NFT 8', c.circuits.address, nft, 'tapeout', ['0x00000002000002', 1, 1])
  if (inventoryEvent(taped, c.circuits.address, nft, 'TapedOut').circuitId !== id) throw new Error('Inventory NFT ID changed')
  await write('Wallet inventory: arm NFT 8', c.mining.address, mining, 'arm', [c.circuits.address, id])
  const key = keccak256(encodePacked(['address', 'uint256'], [c.circuits.address, id]))
  const anchor = await plan.call(c.mining.address, 'function armedAt(bytes32) view returns(uint64)', [key])
  await plan.mineAfterBlock(anchor)
  const header = await plan.rpc('eth_getBlockByNumber', [toHex(anchor), false])
  const proof = notSamples(header.hash, c.circuits.address, id, draft.sampleCount)
  await write('Wallet inventory: start NFT 8', c.mining.address, mining, 'start', [c.circuits.address, id, 1, anchor, proof.inputs, proof.outputs, proof.proofs, ZERO])
  const miner = await plan.readAbi(c.mining.address, mining, 'getMiner', [key])
  if (miner.status !== 1 || miner.taskId !== 1 || miner.optimal || miner.bonus !== 0n || miner.boostBps !== 10000 ||
      miner.verifWeight !== 600n || miner.unverWeight !== 0n || !await plan.call(c.farm.address, 'function admissibleMiner(uint256) view returns(bool)', [id])) throw new Error('Inventory miner is not ordinary admissible backing')
  await write('Wallet inventory: approve only NFT 8', c.circuits.address, nft, 'approve', [c.circuitMarket.address, id])
  const listed = await write('Wallet inventory: list NFT 8', c.circuitMarket.address, market, 'list', [c.circuits.address, id, ONLINE_PRICE_WEI])
  if (inventoryEvent(listed, c.circuitMarket.address, market, 'Listed').id !== BigInt(draft.listingId)) throw new Error('Inventory listing ID changed')
  await plan.write('Wallet inventory: prepare exact OKX TEST-FAB balance', c.fab.address,
    'function transfer(address,uint256) returns(bool)', [INVENTORY_RECIPIENT, INVENTORY_FAB_RAW])
  const view = await plan.call(c.circuitMarket.address, 'function listingView(uint256) view returns(address,address,uint256,uint96,uint16,bool)', [BigInt(draft.listingId)])
  if (!same(view[0], ONLINE_OWNER) || !same(view[1], c.circuits.address) || view[2] !== id || view[3] !== ONLINE_PRICE_WEI || view[4] !== 0 || !view[5] ||
      !same(await plan.call(c.circuits.address, 'function ownerOf(uint256) view returns(address)', [id]), ONLINE_OWNER) ||
      !same(await plan.call(c.circuits.address, 'function getApproved(uint256) view returns(address)', [id]), c.circuitMarket.address)) throw new Error('Prepared inventory listing mismatch')
  const retail = await plan.call(c.circuitMarket.address, 'function listingView(uint256) view returns(address,address,uint256,uint96,uint16,bool)', [2n])
  if (json(retail) !== draft.reservedRetail) throw new Error('Reserved retail listing changed')
  const recipientFab = await plan.call(c.fab.address, 'function balanceOf(address) view returns(uint256)', [INVENTORY_RECIPIENT])
  if (recipientFab - BigInt(draft.recipientFabBeforeRaw) !== INVENTORY_FAB_RAW ||
      await plan.call(c.farm.address, 'function minerCount() view returns(uint256)') !== 3n) throw new Error('Wallet funding or untouched farm mismatch')
  plan.result = { completed: true, productionTouched: false, chain196Touched: false, minerId: draft.minerId,
    listingId: draft.listingId, recipient: INVENTORY_RECIPIENT, recipientFabDeltaRaw: String(INVENTORY_FAB_RAW),
    reservedRetailPreserved: true, farmStillUnchanged: true, publicWrites: false }
  plan.save()
}
