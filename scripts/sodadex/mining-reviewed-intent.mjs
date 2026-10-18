import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { decodeFunctionData, encodeFunctionData, parseAbi, toHex } from 'viem'
import { productArtifact, sourceArtifact } from './mining-plan-artifacts.mjs'
import { notSamples } from './mining-plan-nfts.mjs'

const sourceFiles = ['mining-plan-artifacts.mjs', 'mining-plan-rpc.mjs', 'mining-plan-stack.mjs', 'mining-plan-nfts.mjs',
  'mining-plan-business.mjs', 'mining-permit2-proof.mjs', 'mining-public-execution.mjs', 'mining-public-rpc.mjs', 'mining-fee-model.mjs', 'mining-reviewed-intent.mjs', 'execute-mining-stage2.mjs']
export function miningExecutionSources(root) {
  const files = [...sourceFiles.map((f) => `scripts/sodadex/${f}`), 'standalone/mining-math.ts']
  return Object.fromEntries(files.map((f) => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]))
}
const json = (x) => JSON.stringify(x, (_, value) => typeof value === 'bigint' ? value.toString() : value)

/** Only time-bound authorization and real-block proofs may differ from the full rehearsal. */
export async function assertReviewedMiningIntent(plan, root, row, to, data, value, resolveArtifact = productArtifact) {
  if (BigInt(row.value) !== value) throw new Error('Native amount differs from reviewed intent')
  if (row.data.toLowerCase() === data.toLowerCase()) return
  if (!to) throw new Error('Creation bytecode differs from reviewed intent')
  const abi = ['IgnixManager', 'FabMiningFarm', 'MiningProjectVault', 'FabFragmentPool', 'IgnixLiquidityHelper']
    .flatMap((name) => resolveArtifact(root, name).value.abi)
  abi.push(...sourceArtifact(root, 'PodMining').value.abi, ...parseAbi([
    'function addLiquidityETH(address,uint256,uint256,uint256,address,uint256) payable returns(uint256,uint256,uint256)',
    'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)',
  ]))
  const actual = decodeFunctionData({ abi, data }), expected = decodeFunctionData({ abi, data: row.data })
  if (actual.functionName !== expected.functionName || encodeFunctionData({ abi, functionName: actual.functionName, args: actual.args }).toLowerCase() !== data.toLowerCase()) throw new Error('Noncanonical dynamic calldata')
  const a = structuredClone(actual.args), e = expected.args
  const name = actual.functionName
  if (!['createToken', 'buyMiner', 'convertTax', 'addLiquidityETH', 'addLiquidity', 'removeLiquidity', 'swapExactIn',
    'swapExactTokensForTokensSupportingFeeOnTransferTokens', 'start', 'addTask'].includes(name)) throw new Error('Static calldata differs from reviewed intent')
  const now = BigInt((await plan.rpc('eth_getBlockByNumber', ['pending', false])).timestamp)
  const deadline = (v, seconds) => { if (typeof v !== 'bigint' || v <= now || v > now + BigInt(seconds)) throw new Error('Dynamic deadline exceeds reviewed bounds') }
  if (name === 'createToken') {
    deadline(a[3], 3600); a[3] = e[3]; a[7] = e[7]
  } else if (name === 'buyMiner' || name === 'convertTax') {
    deadline(a[0].deadline, 60); a[0].deadline = e[0].deadline; a[1] = e[1]
  } else if (['addLiquidityETH', 'addLiquidity', 'removeLiquidity', 'swapExactIn', 'swapExactTokensForTokensSupportingFeeOnTransferTokens'].includes(name)) {
    const i = a.length - 1; deadline(a[i], 600); a[i] = e[i]
  } else if (name === 'start' || name === 'addTask') {
    const anchorIndex = name === 'start' ? 3 : 9, inputsIndex = anchorIndex + 1
    const id = name === 'start' ? a[1] : a[8], circuits = name === 'start' ? a[0] : a[7], anchor = a[anchorIndex]
    const latest = BigInt(await plan.rpc('eth_blockNumber'))
    if (anchor >= latest || latest - anchor > 200n) throw new Error('Public mining proof anchor is stale')
    const header = await plan.rpc('eth_getBlockByNumber', [toHex(anchor), false])
    const proof = notSamples(header.hash, circuits, id, e[inputsIndex].length)
    if (json(a.slice(inputsIndex, inputsIndex + 3)).toLowerCase() !== json([proof.inputs, proof.outputs, proof.proofs]).toLowerCase()) throw new Error('Public mining proof differs from real anchor')
    for (let i = anchorIndex; i <= inputsIndex + 2; i++) a[i] = e[i]
  } else throw new Error('Static calldata differs from reviewed intent')
  if (json(a) !== json(e)) throw new Error('Fixed arguments differ from reviewed intent; rerun the full rehearsal')
}
