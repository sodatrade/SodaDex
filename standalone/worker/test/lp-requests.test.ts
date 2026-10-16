import { describe, expect, it, vi } from 'vitest'
import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, type Address, type Hex } from 'viem'
import { validContractRequest } from '../src/trade-requests'
import { V3_LP, V4_LP } from '../src/lp-requests'
import { deployment, ZERO } from '../src/contracts'
import * as policy from '../../trading-policy'
const owner = deployment.owner as Address
const other = '0x1111111111111111111111111111111111111111'
const token0 = '0x2222222222222222222222222222222222222222'
const token1 = deployment.wrappedNative as Address
const tx = (protocol: 'v3' | 'v4', data: Hex, value = '0x0'): object => ({ from: owner, to: protocol === 'v3' ? deployment.contracts.v3PositionManager : deployment.contracts.v4PositionManager, data, value })
const mint = (recipient: Address = owner): Hex => encodeFunctionData({ abi: V3_LP, functionName: 'mint', args: [{ token0, token1, fee: 100, tickLower: -100, tickUpper: 100, amount0Desired: 20n, amount1Desired: 30n, amount0Min: 19n, amount1Min: 29n, recipient, deadline: 2_000_000_000n }] })
const key = { currency0: ZERO as Address, currency1: token0 as Address, fee: 0, tickSpacing: 1, hooks: ZERO as Address }
function mint4(recipient: Address = owner, action: Hex = '0x020d14'): Hex {
  const params = [
    encodeAbiParameters(parseAbiParameters('(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),int24,int24,uint256,uint128,uint128,address,bytes'), [key, -100, 100, 1n, 10n, 20n, recipient, '0x']),
    encodeAbiParameters(parseAbiParameters('address,address'), [key.currency0, key.currency1]),
    encodeAbiParameters(parseAbiParameters('address,address'), [ZERO as Address, owner]),
  ]
  return encodeFunctionData({ abi: V4_LP, functionName: 'modifyLiquidities', args: [encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), [action, params]), 2_000_000_000n] })
}
function modify4(action: Hex, values: Hex[]): Hex {
  return encodeFunctionData({ abi: V4_LP, functionName: 'modifyLiquidities', args: [encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), [action, values]), 2_000_000_000n] })
}
describe('canonical LP simulation boundary', () => {
  it('keeps finite LP approval and mint available independently of public swap pause', () => {
    const spy = vi.spyOn(policy, 'publicSwapsEnabled').mockReturnValue(false)
    const abi = parseAbi(['function approve(address,uint256)'])
    for (const spender of [deployment.permit2, deployment.contracts.v3PositionManager]) {
      expect(validContractRequest({ from: owner, to: token0, data: encodeFunctionData({ abi, functionName: 'approve', args: [spender as Address, 25n] }) }, true)).toBe(true)
      expect(validContractRequest({ from: owner, to: token0, data: encodeFunctionData({ abi, functionName: 'approve', args: [spender as Address, 2n ** 256n - 1n] }) }, true)).toBe(false)
    }
    expect(validContractRequest(tx('v3', mint()), true)).toBe(true)
    expect(validContractRequest(tx('v4', mint4(), '0xa'), true)).toBe(true)
    spy.mockRestore()
  })
  it('rejects recipient, action, value and trailing data substitutions', () => {
    expect(validContractRequest(tx('v3', mint(other)), true)).toBe(false)
    expect(validContractRequest(tx('v3', `${mint()}00`), true)).toBe(false)
    expect(validContractRequest(tx('v4', mint4(other), '0xa'), true)).toBe(false)
    expect(validContractRequest(tx('v4', mint4(owner, '0x050d14'), '0xa'), true)).toBe(false)
    expect(validContractRequest(tx('v4', mint4(), '0xb'), true)).toBe(false)
  })
  it('allows native refunds only within an atomic, nonnested mint multicall', () => {
    const refund = encodeFunctionData({ abi: V3_LP, functionName: 'refundETH' })
    const bundle = encodeFunctionData({ abi: V3_LP, functionName: 'multicall', args: [[mint(), refund]] })
    expect(validContractRequest(tx('v3', bundle, '0x1e'), true)).toBe(true)
    expect(validContractRequest(tx('v3', mint(), '0x1e'), true)).toBe(false)
    expect(validContractRequest(tx('v3', refund), true)).toBe(false)
    expect(validContractRequest(tx('v3', encodeFunctionData({ abi: V3_LP, functionName: 'multicall', args: [[bundle]] })), true)).toBe(false)
  })
  it('rejects NFT transfer and permit/operator approvals', () => {
    const abi = parseAbi(['function transferFrom(address,address,uint256)', 'function setApprovalForAll(address,bool)'])
    for (const data of [encodeFunctionData({ abi, functionName: 'transferFrom', args: [owner, other, 1n] }), encodeFunctionData({ abi, functionName: 'setApprovalForAll', args: [other, true] })]) expect(validContractRequest(tx('v3', data), true)).toBe(false)
  })
  it('requires ordered, atomic V3 collection and terminal native refund', () => {
    const collect = encodeFunctionData({ abi: V3_LP, functionName: 'collect', args: [{ tokenId: 1n, recipient: ZERO as Address, amount0Max: 100n, amount1Max: 100n }] })
    const unwrap = encodeFunctionData({ abi: V3_LP, functionName: 'unwrapWETH9', args: [0n, owner] })
    const sweep = encodeFunctionData({ abi: V3_LP, functionName: 'sweepToken', args: [token0, 0n, owner] })
    const bundle = (calls: Hex[], value = '0x0'): boolean => validContractRequest(tx('v3', encodeFunctionData({ abi: V3_LP, functionName: 'multicall', args: [calls] }), value), true)
    expect(bundle([collect, unwrap, sweep])).toBe(true)
    expect(bundle([unwrap, sweep, collect])).toBe(false)
    expect(bundle([collect, sweep, unwrap])).toBe(false)
    const decrease = encodeFunctionData({ abi: V3_LP, functionName: 'decreaseLiquidity', args: [{ tokenId: 2n, liquidity: 1n, amount0Min: 0n, amount1Min: 0n, deadline: 2_000_000_000n }] })
    expect(bundle([decrease, collect, unwrap, sweep])).toBe(false)
    const refund = encodeFunctionData({ abi: V3_LP, functionName: 'refundETH' })
    expect(bundle([refund, mint()], '0x1e')).toBe(false)
  })
  it('uses V4 close-currency for increase so either token may credit accrued fees', () => {
    const inputs = [
      encodeAbiParameters(parseAbiParameters('uint256,uint256,uint128,uint128,bytes'), [1n, 1n, 10n, 20n, '0x']),
      encodeAbiParameters(parseAbiParameters('address'), [key.currency0]),
      encodeAbiParameters(parseAbiParameters('address'), [key.currency1]),
      encodeAbiParameters(parseAbiParameters('address,address'), [ZERO as Address, owner]),
    ]
    expect(validContractRequest(tx('v4', modify4('0x00121214', inputs), '0xa'), true)).toBe(true)
    expect(validContractRequest(tx('v4', modify4('0x00121214', [inputs[0], inputs[2], inputs[1], inputs[3]]), '0xa'), true)).toBe(false)
    expect(validContractRequest(tx('v4', modify4('0x000d14', [inputs[0], encodeAbiParameters(parseAbiParameters('address,address'), [key.currency0, key.currency1]), inputs[3]]), '0xa'), true)).toBe(false)
  })
  it('admits V4 fees via zero liquidity decrease/take, never a redirected take', () => {
    const encode = (recipient: Address): Hex => encodeFunctionData({ abi: V4_LP, functionName: 'modifyLiquidities', args: [encodeAbiParameters(parseAbiParameters('bytes,bytes[]'), ['0x0111', [encodeAbiParameters(parseAbiParameters('uint256,uint256,uint128,uint128,bytes'), [1n, 0n, 0n, 0n, '0x']), encodeAbiParameters(parseAbiParameters('address,address,address'), [key.currency0, key.currency1, recipient])]]), 2_000_000_000n] })
    expect(validContractRequest(tx('v4', encode(owner)), true)).toBe(true)
    expect(validContractRequest(tx('v4', encode(other)), true)).toBe(false)
  })
})
