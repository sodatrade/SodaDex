import { decodeAbiParameters, parseAbiParameters, type Hex } from 'viem'
import { deployment, NFT_READ, same, V3_POSITION_READ, V4_POSITION_READ, ZERO } from './contracts'
import { canonicalDecode, V3_LP, V4_LP } from './lp-requests'
import { call } from './upstream'

/** Ownership and currency bindings that cannot be proven from calldata alone. */
export async function validLiquidityContext(to: string, data: Hex, sender: string, value: bigint, block: string, upstreamFetch: typeof fetch): Promise<boolean> {
  if (!same(to, deployment.contracts.v3PositionManager) && !same(to, deployment.contracts.v4PositionManager)) return true
  const abi = same(to, deployment.contracts.v3PositionManager) ? V3_LP : V4_LP
  const top = canonicalDecode(abi, data)
  const calls = top.functionName === 'multicall' ? top.args[0] as readonly Hex[] : [data]
  for (const encoded of calls) {
    const decoded = canonicalDecode(abi, encoded)
    let tokenId: bigint | null = null
    let currencies: readonly string[] | null = null
    let burning = decoded.functionName === 'burn'
    if (decoded.functionName === 'safeTransferFrom') tokenId = decoded.args[2] as bigint
    if (burning) tokenId = decoded.args[0] as bigint
    if (same(to, deployment.contracts.v3PositionManager) && ['increaseLiquidity', 'decreaseLiquidity', 'collect'].includes(decoded.functionName)) tokenId = (decoded.args[0] as { tokenId: bigint }).tokenId
    if (same(to, deployment.contracts.v4PositionManager) && decoded.functionName === 'modifyLiquidities') {
      const [actions, inputs] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), decoded.args[0] as Hex)
      burning = actions === '0x0311'
      if (actions !== '0x020d14') {
        tokenId = decodeAbiParameters(parseAbiParameters('uint256'), inputs[0])[0]
        currencies = actions === '0x00121214'
          ? [decodeAbiParameters(parseAbiParameters('address'), inputs[1])[0], decodeAbiParameters(parseAbiParameters('address'), inputs[2])[0]]
          : decodeAbiParameters(parseAbiParameters('address,address,address'), inputs[1]).slice(0, 2) as readonly string[]
      }
    }
    if (tokenId === null) continue
    const owner = await call(NFT_READ, to, 'ownerOf', [tokenId], block, upstreamFetch)
    if (typeof owner !== 'string' || !same(owner, sender)) return false
    if (currencies) {
      const info = await call(V4_POSITION_READ, to, 'getPoolAndPositionInfo', [tokenId], block, upstreamFetch)
      if (!Array.isArray(info)) return false
      const key = info[0] as { currency0: string; currency1: string; hooks: string }
      if (!same(key.currency0, currencies[0]) || !same(key.currency1, currencies[1]) || !same(key.hooks, ZERO)) return false
      if (burning && await call(V4_POSITION_READ, to, 'getPositionLiquidity', [tokenId], block, upstreamFetch) !== 0n) return false
    }
    if (same(to, deployment.contracts.v3PositionManager)) {
      const position = await call(V3_POSITION_READ, to, 'positions', [tokenId], block, upstreamFetch)
      if (!Array.isArray(position)) return false
      const token0 = String(position[2]), token1 = String(position[3])
      if (burning && [position[7], position[10], position[11]].some(amount => amount !== 0n)) return false
      if (value > 0n) {
        const p = decoded.args[0] as { amount0Desired: bigint; amount1Desired: bigint }
        if (!((same(token0, deployment.wrappedNative) && value === p.amount0Desired) || (same(token1, deployment.wrappedNative) && value === p.amount1Desired))) return false
      }
      if (decoded.functionName === 'collect' && same((decoded.args[0] as { recipient: string }).recipient, ZERO)) {
        if (![token0, token1].some((address) => same(address, deployment.wrappedNative))) return false
        const sweep = calls.map((item) => canonicalDecode(V3_LP, item)).find((item) => item.functionName === 'sweepToken')
        if (!sweep || !same(String(sweep.args[0]), same(token0, deployment.wrappedNative) ? token1 : token0)) return false
      }
    }
  }
  return true
}
