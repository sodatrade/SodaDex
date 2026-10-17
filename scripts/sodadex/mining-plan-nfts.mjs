import { decodeEventLog, encodeFunctionData, encodeAbiParameters, encodePacked, keccak256, parseAbiParameters, toHex } from 'viem'
import { sourceArtifact } from './mining-plan-artifacts.mjs'

const ROOT = '0x512a481c149182d2bb970a739af3326608786cc59316188485ff0d3f340d3a2d'
const LEAVES = ['0xe5361c49e0b3d5baadd22cd81b926c04d3f517e3f11e635b244f7672a8f418f0',
  '0x0696c82f2594a9cb1793ca5414b45631fa05d4a64d7acda72ba1dbcc43d618df']

export function notSamples(hash, circuits, id, count) {
  const samples = { inputs: [], outputs: [], proofs: [] }
  for (let k = 0; k < count; k++) {
    const index = Number(BigInt(keccak256(encodePacked(['bytes32', 'address', 'uint256', 'uint32'], [hash, circuits, id, k]))) % 2n)
    samples.inputs.push(index ? '0x01' : '0x00'); samples.outputs.push(index ? '0x00' : '0x01'); samples.proofs.push([LEAVES[1 - index]])
  }
  return samples
}

export async function prepareMiningNfts(plan, root, stack) {
  const sourceAbi = sourceArtifact(root, 'PodMining').value.abi, nftAbi = sourceArtifact(root, 'Circuits').value.abi
  const writeSource = async (label, name, args) => plan.send(label, stack.mining, encodeFunctionData({ abi: sourceAbi, functionName: name, args }))
  for (const [index, input, output] of [[0n, '0x00', '0x01'], [1n, '0x01', '0x00']]) {
    const leaf = keccak256(keccak256(encodeAbiParameters(parseAbiParameters('uint256,bytes,bytes'), [index, input, output])))
    if (leaf !== LEAVES[Number(index)]) throw new Error('NOT proof fixture changed')
  }
  if (await plan.call(stack.circuits, 'function TAPEOUT_FEE() view returns(uint256)') !== 0n ||
      await plan.call(stack.mining, 'function paused() view returns(bool)') !== false ||
      await plan.call(stack.mining, 'function processorMultiplier(address) view returns(uint256)', [stack.circuits]) !== 6n)
    throw new Error('Unexpected test fees or mining model')
  await plan.write('Mint five test NAND units', stack.transistors, 'function mint(uint256,uint256) payable', [0n, 5n])
  const ids = [], receipts = []
  for (let index = 0; index < 5; index++) {
    const receipt = await plan.write(`Tape out test NOT NFT ${index}`, stack.circuits, 'function tapeout(bytes,uint32,uint32) payable returns(uint256)', ['0x00000002000002', 1, 1])
    const event = receipt.logs.filter((l) => l.address.toLowerCase() === stack.circuits.toLowerCase()).map((log) => {
      try { return decodeEventLog({ abi: nftAbi, data: log.data, topics: log.topics }) } catch { return undefined }
    }).find((entry) => entry?.eventName === 'TapedOut')
    if (!event) throw new Error('Missing real NFT tapeout event')
    const id = event.args.circuitId
    if (typeof id !== 'bigint' || (await plan.call(stack.circuits, 'function ownerOf(uint256) view returns(address)', [id])).toLowerCase() !== plan.owner.toLowerCase()) throw new Error('Unexpected minted NFT owner')
    ids.push(id); receipts.push(receipt)
  }
  const sampleCount = await plan.call(stack.mining, 'function sampleCountFor(uint32,uint32) view returns(uint32)', [1, 1])
  if (!Number.isInteger(sampleCount) || sampleCount <= 0) throw new Error('Invalid sample count')
  const anchor = BigInt(receipts[0].blockNumber), header = await plan.rpc('eth_getBlockByNumber', [toHex(anchor), false])
  const vectors = notSamples(header.hash, stack.circuits, ids[0], sampleCount)
  await writeSource('Add genuine NOT task', 'addTask', ['SodaDEX TEST NOT', 0, 1, 1, 1, 2, ROOT, stack.circuits, ids[0], anchor,
    vectors.inputs, vectors.outputs, vectors.proofs])
  const task = await plan.call(stack.mining, 'function taskCount() view returns(uint32)')
  if (task !== 1) throw new Error('Unexpected task identifier')
  for (const [index, id] of ids.slice(1).entries()) {
    await writeSource(`Arm verified test miner ${id}`, 'arm', [stack.circuits, id])
    const key = keccak256(encodePacked(['address', 'uint256'], [stack.circuits, id]))
    const armed = await plan.call(stack.mining, 'function armedAt(bytes32) view returns(uint64)', [key])
    // Actual public execution waits for this block; only the local rehearsal mines it explicitly.
    await plan.mineAfterBlock(armed)
    const block = await plan.rpc('eth_getBlockByNumber', [toHex(armed), false])
    const proof = notSamples(block.hash, stack.circuits, id, sampleCount)
    await writeSource(`Start verified test miner ${id}`, 'start', [stack.circuits, id, task, armed, proof.inputs, proof.outputs, proof.proofs, `0x${'0'.repeat(64)}`])
    const miner = await plan.readAbi(stack.mining, sourceAbi, 'getMiner', [key])
    if (miner.status !== 1 || miner.taskId !== task || miner.optimal !== (index === 0) || miner.boostBps !== 10000 ||
        (index !== 0 && (BigInt(miner.bonus) !== 0n || BigInt(miner.verifWeight) !== 600n || BigInt(miner.unverWeight) !== 0n))) throw new Error('Actual test miner admission differs')
  }
  const result = { reference: String(ids[0]), leader: String(ids[1]), farm: String(ids[2]), fragment: String(ids[3]), user: String(ids[4]), task }
  plan.miners = result; plan.save()
  return result
}
