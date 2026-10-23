import { encodeAbiParameters, keccak256, padHex, parseAbiParameters, stringToHex, toHex } from 'viem'
import { createHash } from 'node:crypto'
import { productArtifact, PRODUCT_SNAPSHOT } from './mining-plan-artifacts.mjs'

export async function verifyMiningPermit2(plan, root, address) {
  if (await plan.rpc('eth_chainId') !== '0x7a0') throw new Error('Permit2 verification requires 1952')
  const block = await plan.rpc('eth_blockNumber'), header = await plan.rpc('eth_getBlockByNumber', [block, false])
  const code = await plan.rpc('eth_getCode', [address, block]), artifact = productArtifact(root, 'Permit2').value
  let expected = artifact.deployedBytecode.object
  if (!expected.startsWith('0x')) expected = `0x${expected}`
  const domain = keccak256(encodeAbiParameters(parseAbiParameters('bytes32,bytes32,uint256,address'),
    [keccak256(stringToHex('EIP712Domain(string name,uint256 chainId,address verifyingContract)')), keccak256(stringToHex('Permit2')), 1952n, address]))
  const sites = Object.values(artifact.deployedBytecode.immutableReferences).flat().sort((a, b) => a.start - b.start)
  if (sites.length !== 2 || sites[0].start !== 6945 || sites[1].start !== 6983 || sites.some((s) => s.length !== 32)) throw new Error('Permit2 immutable layout changed')
  const replacements = [padHex(toHex(1952), { size: 32 }), domain]
  for (const [i, site] of sites.entries()) {
    const start = 2 + site.start * 2, end = start + site.length * 2
    if (code.slice(start, end).toLowerCase() !== replacements[i].slice(2)) throw new Error('Permit2 cached chain/domain mismatch')
    expected = expected.slice(0, start) + replacements[i].slice(2) + expected.slice(end)
  }
  if (code.toLowerCase() !== expected.toLowerCase() || await plan.call(address, 'function DOMAIN_SEPARATOR() view returns(bytes32)', [], block) !== domain)
    throw new Error('Permit2 frozen runtime/domain mismatch')
  return { schemaVersion: 1, chainId: 1952, address, blockNumber: String(BigInt(block)), blockHash: header.hash, productSnapshot: PRODUCT_SNAPSHOT,
    runtimeBytes: (code.length - 2) / 2, runtimeSha256: createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex'),
    runtimeKeccak256: keccak256(code), domain, immutableSlots: sites.map((s, i) => ({ ...s, value: replacements[i] })),
    runtimeIncludingImmutablesMatches: true, domainMatches: true }
}
