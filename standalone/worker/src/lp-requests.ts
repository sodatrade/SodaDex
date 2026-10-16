import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, type Abi, type Address, type Hex } from 'viem'
import { deployment, same, ZERO } from './contracts'

export const V3_LP = parseAbi([
  'function multicall(bytes[] data) payable returns(bytes[])',
  'function createAndInitializePoolIfNecessary(address token0,address token1,uint24 fee,uint160 sqrtPriceX96) payable returns(address)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns(uint256,uint128,uint256,uint256)',
  'function increaseLiquidity((uint256 tokenId,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns(uint128,uint256,uint256)',
  'function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns(uint256,uint256)',
  'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) payable returns(uint256,uint256)',
  'function refundETH() payable', 'function unwrapWETH9(uint256 amountMinimum,address recipient) payable',
  'function sweepToken(address token,uint256 amountMinimum,address recipient) payable',
])
export const V4_LP = parseAbi([
  'function multicall(bytes[] data) payable returns(bytes[])',
  'function initializePool((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint160 sqrtPriceX96) payable returns(int24)',
  'function modifyLiquidities(bytes unlockData,uint256 deadline) payable',
])
const ACTIONS = parseAbiParameters('bytes,bytes[]')
const MINT = parseAbiParameters('(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),int24,int24,uint256,uint128,uint128,address,bytes')
const MODIFY = parseAbiParameters('uint256,uint256,uint128,uint128,bytes')
const PAIR = parseAbiParameters('address,address')
const TAKE = parseAbiParameters('address,address,address')
const SWEEP = parseAbiParameters('address,address')
export function canonicalDecode(abi: Abi, data: Hex): { functionName: string; args: readonly unknown[] } {
  const decoded = decodeFunctionData({ abi, data })
  if (!same(encodeFunctionData({ abi, functionName: decoded.functionName, args: decoded.args }), data)) throw new Error('Noncanonical calldata')
  return { functionName: decoded.functionName, args: decoded.args ?? [] }
}
function params<const T extends Parameters<typeof decodeAbiParameters>[0]>(abi: T, data: Hex): ReturnType<typeof decodeAbiParameters<T>> {
  const decoded = decodeAbiParameters(abi, data)
  if (!same(encodeAbiParameters(abi, decoded as never), data)) throw new Error('Noncanonical parameters')
  return decoded
}
function sorted(a: string, b: string): boolean { return BigInt(a) < BigInt(b) }
function validKey(key: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }): boolean {
  return sorted(key.currency0, key.currency1) && key.fee >= 0 && key.fee <= 1_000_000 && key.tickSpacing > 0 && key.tickSpacing <= 32767 && same(key.hooks, ZERO)
}
function range(lower: number, upper: number): boolean { return lower >= -887272 && upper <= 887272 && lower < upper }
function sqrt(value: bigint): boolean { return value >= 4295128739n && value < 1461446703485210103287273052203988822378723970342n }
function finite(value: bigint): boolean { return value >= 0n && value < 2n ** 160n - 1n }

function v3(data: Hex, sender: string, value: bigint, nested = false): boolean {
  const decoded = canonicalDecode(V3_LP, data)
  if (decoded.functionName === 'multicall') {
    if (nested) return false
    const [calls] = decoded.args as readonly [readonly Hex[]]
    if (calls.length < 1 || calls.length > 5) return false
    let substantive = 0
    for (const call of calls) {
      if (!v3(call, sender, value, true)) return false
      const name = canonicalDecode(V3_LP, call).functionName
      if (['mint', 'increaseLiquidity', 'decreaseLiquidity', 'collect'].includes(name)) substantive++
    }
    const decodedCalls = calls.map((call) => canonicalDecode(V3_LP, call))
    const custody = decodedCalls.filter((call) => call.functionName === 'collect' && same((call.args[0] as {recipient: string}).recipient, ZERO))
    if (!custody.length && decodedCalls.some((call) => ['unwrapWETH9', 'sweepToken'].includes(call.functionName))) return false
    if (custody.length && (!decodedCalls.some((call) => call.functionName === 'unwrapWETH9') || !decodedCalls.some((call) => call.functionName === 'sweepToken'))) return false
    if (value > 0n && !decodedCalls.some((call) => call.functionName === 'refundETH')) return false
    const operations = decodedCalls.filter((call) => ['mint', 'increaseLiquidity', 'decreaseLiquidity', 'collect'].includes(call.functionName)).map((call) => call.functionName).join(',')
    if (!['mint', 'increaseLiquidity', 'decreaseLiquidity', 'collect', 'decreaseLiquidity,collect'].includes(operations)) return false
    const initialize = decodedCalls.filter((call) => call.functionName === 'createAndInitializePoolIfNecessary')
    if (initialize.length > 1 || (initialize.length && operations !== 'mint')) return false
    if (initialize.length) {
      const [a, b, fee] = initialize[0].args as readonly [string, string, number]
      const minted = decodedCalls.find((call) => call.functionName === 'mint')!.args[0] as {token0: string; token1: string; fee: number}
      if (!same(a, minted.token0) || !same(b, minted.token1) || fee !== minted.fee) return false
    }
    return substantive >= 1 && substantive <= 2
  }
  if (decoded.functionName === 'createAndInitializePoolIfNecessary') {
    const [token0, token1, fee, price] = decoded.args as readonly [Address, Address, number, bigint]
    return (nested || value === 0n) && !same(token0, ZERO) && sorted(token0, token1) && fee < 1_000_000 && sqrt(price)
  }
  if (decoded.functionName === 'refundETH') return nested
  if (decoded.functionName === 'unwrapWETH9') {
    const [, recipient] = decoded.args as readonly [bigint, Address]
    return nested && same(recipient, sender)
  }
  if (decoded.functionName === 'sweepToken') {
    const [, , recipient] = decoded.args as readonly [Address, bigint, Address]
    return nested && same(recipient, sender)
  }
  if (decoded.functionName === 'mint') {
    const [p] = decoded.args as readonly [{ token0: Address; token1: Address; fee: number; tickLower: number; tickUpper: number; amount0Desired: bigint; amount1Desired: bigint; amount0Min: bigint; amount1Min: bigint; recipient: Address; deadline: bigint }]
    return !same(p.token0, ZERO) && sorted(p.token0, p.token1) && p.fee < 1_000_000 && range(p.tickLower, p.tickUpper) &&
      finite(p.amount0Desired) && finite(p.amount1Desired) && p.amount0Desired + p.amount1Desired > 0n &&
      p.amount0Min <= p.amount0Desired && p.amount1Min <= p.amount1Desired && same(p.recipient, sender) && p.deadline > 0n &&
      (value === 0n || (nested && ((same(p.token0, deployment.wrappedNative) && value === p.amount0Desired) || (same(p.token1, deployment.wrappedNative) && value === p.amount1Desired))))
  }
  if (decoded.functionName === 'increaseLiquidity') {
    const [p] = decoded.args as readonly [{ tokenId: bigint; amount0Desired: bigint; amount1Desired: bigint; amount0Min: bigint; amount1Min: bigint; deadline: bigint }]
    return p.tokenId > 0n && finite(p.amount0Desired) && finite(p.amount1Desired) && p.amount0Desired + p.amount1Desired > 0n && p.amount0Min <= p.amount0Desired && p.amount1Min <= p.amount1Desired && p.deadline > 0n && (value === 0n || (nested && (value === p.amount0Desired || value === p.amount1Desired)))
  }
  if (decoded.functionName === 'decreaseLiquidity') {
    const [p] = decoded.args as readonly [{ tokenId: bigint; liquidity: bigint; deadline: bigint }]
    return value === 0n && p.tokenId > 0n && p.liquidity > 0n && p.deadline > 0n
  }
  if (decoded.functionName === 'collect') {
    const [p] = decoded.args as readonly [{ tokenId: bigint; recipient: Address; amount0Max: bigint; amount1Max: bigint }]
    // Zero-address custody is admitted only inside an atomic unwrap/sweep multicall above.
    return value === 0n && p.tokenId > 0n && (same(p.recipient, sender) || (nested && same(p.recipient, ZERO))) && p.amount0Max + p.amount1Max > 0n
  }
  return false
}
function v4(data: Hex, sender: string, value: bigint, nested = false): boolean {
  const decoded = canonicalDecode(V4_LP, data)
  if (decoded.functionName === 'multicall') {
    const [calls] = decoded.args as readonly [readonly Hex[]]
    if (nested || calls.length !== 2 || canonicalDecode(V4_LP, calls[0]).functionName !== 'initializePool' || canonicalDecode(V4_LP, calls[1]).functionName !== 'modifyLiquidities' || !calls.every((call) => v4(call, sender, value, true))) return false
    const initial = canonicalDecode(V4_LP, calls[0]).args[0] as {currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string}
    const [actions, inputs] = params(ACTIONS, canonicalDecode(V4_LP, calls[1]).args[0] as Hex)
    if (actions !== '0x020d14') return false
    const [minted] = params(MINT, inputs[0])
    return same(initial.currency0, minted.currency0) && same(initial.currency1, minted.currency1) && initial.fee === minted.fee && initial.tickSpacing === minted.tickSpacing && same(initial.hooks, minted.hooks)
  }
  if (decoded.functionName === 'initializePool') {
    const [key, price] = decoded.args as readonly [{ currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }, bigint]
    return validKey(key) && sqrt(price) && (nested || value === 0n)
  }
  const [unlock, deadline] = decoded.args as readonly [Hex, bigint]
  if (decoded.functionName !== 'modifyLiquidities' || deadline <= 0n) return false
  const [actions, inputs] = params(ACTIONS, unlock)
  const mint = actions === '0x020d14'
  const increase = actions === '0x000d14'
  const decrease = actions === '0x0111'
  if ((!mint && !increase && !decrease) || inputs.length !== (decrease ? 2 : 3)) return false
  const [currency0, currency1] = decrease ? params(TAKE, inputs[1]) : params(PAIR, inputs[1])
  if (!sorted(currency0, currency1)) return false
  if (decrease) {
    const [, , recipient] = params(TAKE, inputs[1])
    const [id, liquidity, , , hookData] = params(MODIFY, inputs[0])
    return id > 0n && liquidity >= 0n && hookData === '0x' && same(recipient, sender) && value === 0n
  }
  const [sweepToken, recipient] = params(SWEEP, inputs[2])
  if (!same(sweepToken, ZERO) || !same(recipient, sender)) return false
  if (mint) {
    const [key, lower, upper, liquidity, max0, max1, receiver, hookData] = params(MINT, inputs[0])
    return validKey(key) && same(key.currency0, currency0) && same(key.currency1, currency1) && range(lower, upper) &&
      lower % key.tickSpacing === 0 && upper % key.tickSpacing === 0 && liquidity > 0n && liquidity < 2n ** 128n && max0 + max1 > 0n && same(receiver, sender) && hookData === '0x' && value === (same(currency0, ZERO) ? max0 : 0n)
  }
  const [id, liquidity, max0, max1, hookData] = params(MODIFY, inputs[0])
  return id > 0n && liquidity > 0n && liquidity < 2n ** 128n && max0 + max1 > 0n && hookData === '0x' && value === (same(currency0, ZERO) ? max0 : 0n)
}
export function validLiquidityRequest(to: string, data: Hex, sender: string, value: bigint): boolean {
  try {
    if (same(to, deployment.contracts.v3PositionManager)) return v3(data, sender, value)
    if (same(to, deployment.contracts.v4PositionManager)) return v4(data, sender, value)
    return false
  } catch { return false }
}
