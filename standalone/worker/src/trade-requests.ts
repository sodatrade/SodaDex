import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, type Hex } from 'viem'
import deployment from '../../../deployments/xlayer-test/active.json'
import pools from '../../../deployments/xlayer-test/pools.json'
import { publicSwapsEnabled } from '../../trading-policy'
import { contractReadKind } from './contract-reads'
import { validLiquidityRequest } from './lp-requests'

const ZERO = '0x0000000000000000000000000000000000000000'
const ROUTER = deployment.contracts.universalRouter.toLowerCase()
const PERMIT2 = deployment.permit2.toLowerCase()
const STABLE = pools.stable.address.toLowerCase()
const WOKB = deployment.wrappedNative.toLowerCase()
const TOKENS = new Set([STABLE, WOKB])
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const DATA = /^0x(?:[0-9a-fA-F]{2})*$/
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/
const ERC20 = parseAbi(['function approve(address spender,uint256 amount)', 'function allowance(address owner,address spender) view returns (uint256)'])
const PERMITS = parseAbi(['function allowance(address owner,address token,address spender) view returns (uint160,uint48,uint48)', 'function approve(address token,address spender,uint160 amount,uint48 expiration)'])
const V3_QUOTE = parseAbi(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256,uint160,uint32,uint256)'])
const V4_QUOTE = parseAbi(['function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256,uint256)'])
const EXECUTE = parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable'])
const V3_SWAP = parseAbiParameters('address recipient,uint256 amountIn,uint256 amountOutMinimum,bytes path,bool payerIsUser,uint256[] minHopPriceX36')
const V4_SWAP = parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData) swap')
const PAIR = parseAbiParameters('address,uint256')
const SWEEP = parseAbiParameters('address,address,uint256')
const ACTIONS = parseAbiParameters('bytes,bytes[]')

function same(a: string, b: string): boolean { return a.toLowerCase() === b.toLowerCase() }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function positive(value: bigint): boolean { return value > 0n && value < 2n ** 160n - 1n }
function knownKey(key: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }): boolean {
  return same(key.currency0, ZERO) && same(key.currency1, STABLE) && key.fee === 0 && key.tickSpacing === 1 && same(key.hooks, ZERO)
}
function path(input: string, output: string): string { return input + '000064' + output.slice(2) }

// Re-encoding rejects trailing bytes, noncanonical offsets and ambiguous payloads.
function params<const T extends Parameters<typeof decodeAbiParameters>[0]>(abi: T, data: Hex): ReturnType<typeof decodeAbiParameters<T>> {
  const result = decodeAbiParameters(abi, data)
  if (!same(encodeAbiParameters(abi, result as never), data)) throw new Error('Noncanonical calldata')
  return result
}

function validExecute(data: Hex, sender: string, value: bigint): boolean {
  const decoded = decodeFunctionData({ abi: EXECUTE, data })
  if (!same(encodeFunctionData({ abi: EXECUTE, functionName: decoded.functionName, args: decoded.args }), data)) return false
  const [commands, inputs, deadline] = decoded.args
  if (deadline <= 0n) return false
  const sweep = (input: Hex): boolean => {
    const [token, receiver, minimum] = params(SWEEP, input)
    return same(token, ZERO) && same(receiver, sender) && minimum === 0n
  }
  if (commands === '0x1004' && inputs.length === 2) {
    const [actions, inner] = params(ACTIONS, inputs[0])
    if (actions !== '0x060c0f' || inner.length !== 3 || !sweep(inputs[1])) return false
    const [swap] = params(V4_SWAP, inner[0])
    const [settleToken, settleAmount] = params(PAIR, inner[1])
    const [takeToken, takeMinimum] = params(PAIR, inner[2])
    return knownKey(swap.poolKey) && positive(swap.amountIn) && swap.amountOutMinimum > 0n &&
      swap.minHopPriceX36 === 0n && swap.hookData === '0x' &&
      same(settleToken, swap.zeroForOne ? ZERO : STABLE) && settleAmount === swap.amountIn &&
      same(takeToken, swap.zeroForOne ? STABLE : ZERO) && takeMinimum === swap.amountOutMinimum &&
      value === (swap.zeroForOne ? swap.amountIn : 0n)
  }
  const nativeIn = commands === '0x0b000c04' && inputs.length === 4
  const nativeOut = commands === '0x000c04' && inputs.length === 3
  if (!nativeIn && !nativeOut) return false
  const [receiver, amount, minimum, encodedPath, payer, minHop] = params(V3_SWAP, inputs[nativeIn ? 1 : 0])
  const [unwrapReceiver, unwrapMinimum] = params(PAIR, inputs[nativeIn ? 2 : 1])
  if (!positive(amount) || minimum === 0n || minHop.length !== 0 || !sweep(inputs[nativeIn ? 3 : 2]) ||
    !same(unwrapReceiver, sender) || unwrapMinimum !== (nativeIn ? 0n : minimum)) return false
  if (nativeIn) {
    const [wrapReceiver, wrapAmount] = params(PAIR, inputs[0])
    return same(wrapReceiver, '0x0000000000000000000000000000000000000002') && wrapAmount === amount && value === amount &&
      same(receiver, sender) && !payer && same(encodedPath, path(WOKB, STABLE))
  }
  return value === 0n && same(receiver, '0x0000000000000000000000000000000000000002') && payer && same(encodedPath, path(STABLE, WOKB))
}

/** Only simulations and reads for the deployed SodaDex pair cross this boundary. */
export function validContractRequest(value: unknown, simulation: boolean): boolean {
  if (!record(value) || Object.keys(value).some((key) => !['from', 'to', 'data', 'value'].includes(key)) ||
    typeof value.to !== 'string' || !ADDRESS.test(value.to) || typeof value.data !== 'string' || !DATA.test(value.data) ||
    (value.from !== undefined && (typeof value.from !== 'string' || !ADDRESS.test(value.from))) ||
    (value.value !== undefined && (typeof value.value !== 'string' || !QUANTITY.test(value.value)))) return false
  const to = value.to.toLowerCase(), data = value.data as Hex
  const amount = BigInt((value.value as string | undefined) ?? '0x0')
  try {
    if (!simulation && amount === 0n && contractReadKind(to, data)) return true
    if (typeof value.from === 'string' && validLiquidityRequest(to, data, value.from, amount)) return true
    if (to !== PERMIT2 && amount === 0n) {
      try {
        const approval = decodeFunctionData({ abi: ERC20, data })
        if (approval.functionName === 'approve' && same(encodeFunctionData({ abi: ERC20, functionName: approval.functionName, args: approval.args }), data) && typeof value.from === 'string' &&
          [PERMIT2, deployment.contracts.v3PositionManager.toLowerCase()].includes(approval.args[0].toLowerCase()) && (approval.args[1] === 0n || positive(approval.args[1]))) return true
      } catch { /* Other selectors continue through the protocol-specific boundary. */ }
    }
    if (TOKENS.has(to)) {
      if (amount !== 0n) return false
      if (!simulation && (/^0x(313ce567|95d89b41|06fdde03)$/.test(data) || /^0x70a082310{24}[0-9a-fA-F]{40}$/.test(data))) return true
      const decoded = decodeFunctionData({ abi: ERC20, data })
      if (!same(encodeFunctionData({ abi: ERC20, functionName: decoded.functionName, args: decoded.args }), data)) return false
      if (decoded.functionName === 'allowance') return !simulation && same(decoded.args[1], PERMIT2)
      return typeof value.from === 'string' && same(decoded.args[0], PERMIT2) &&
        (decoded.args[1] === 0n || (publicSwapsEnabled() && positive(decoded.args[1])))
    }
    if (to === PERMIT2 && amount === 0n) {
      const decoded = decodeFunctionData({ abi: PERMITS, data })
      if (!same(encodeFunctionData({ abi: PERMITS, functionName: decoded.functionName, args: decoded.args }), data)) return false
      if (decoded.functionName === 'allowance') return !simulation && (same(decoded.args[2], ROUTER) || same(decoded.args[2], deployment.contracts.v4PositionManager))
      if (typeof value.from === 'string' && same(decoded.args[1], deployment.contracts.v4PositionManager)) return decoded.args[2] === 0n || (positive(decoded.args[2]) && decoded.args[3] > 0)
      if (typeof value.from === 'string' && same(decoded.args[1], ROUTER) && decoded.args[2] === 0n) return true
      return publicSwapsEnabled() && typeof value.from === 'string' && same(decoded.args[0], STABLE) && same(decoded.args[1], ROUTER) && positive(decoded.args[2]) && decoded.args[3] > 0
    }
    if (!simulation && to === deployment.contracts.v3Quoter.toLowerCase() && amount === 0n) {
      const decoded = decodeFunctionData({ abi: V3_QUOTE, data })
      const [quote] = decoded.args
      return same(encodeFunctionData({ abi: V3_QUOTE, functionName: decoded.functionName, args: decoded.args }), data) &&
        quote.fee === 100 && quote.sqrtPriceLimitX96 === 0n && positive(quote.amountIn) &&
        ((same(quote.tokenIn, WOKB) && same(quote.tokenOut, STABLE)) || (same(quote.tokenIn, STABLE) && same(quote.tokenOut, WOKB)))
    }
    if (!simulation && to === deployment.contracts.v4Quoter.toLowerCase() && amount === 0n) {
      const decoded = decodeFunctionData({ abi: V4_QUOTE, data })
      const [quote] = decoded.args
      return same(encodeFunctionData({ abi: V4_QUOTE, functionName: decoded.functionName, args: decoded.args }), data) && knownKey(quote.poolKey) && positive(quote.exactAmount) && quote.hookData === '0x'
    }
    return publicSwapsEnabled() && to === ROUTER && typeof value.from === 'string' && validExecute(data, value.from, amount)
  } catch { return false }
}
