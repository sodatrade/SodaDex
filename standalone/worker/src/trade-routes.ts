import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, type Hex } from 'viem'
import { deployment, same, ZERO, type PoolReference } from './contracts'

type V3Route = Extract<PoolReference, { protocol: 'v3' }>
type V4Route = Extract<PoolReference, { protocol: 'v4' }>
const EXECUTE = parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable'])
const V3_SWAP = parseAbiParameters('address recipient,uint256 amountIn,uint256 amountOutMinimum,bytes path,bool payerIsUser,uint256[] minHopPriceX36')
const V4_SWAP = parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData) swap')
const PAIR = parseAbiParameters('address,uint256')
const SWEEP = parseAbiParameters('address,address,uint256')
const ACTIONS = parseAbiParameters('bytes,bytes[]')
const ROUTER_CUSTODY = '0x0000000000000000000000000000000000000002'
function positive(value: bigint): boolean { return value > 0n && value < 2n ** 160n - 1n }

// Stateless validation; registration is checked separately at the requested block.
function params<const T extends Parameters<typeof decodeAbiParameters>[0]>(abi: T, data: Hex): ReturnType<typeof decodeAbiParameters<T>> {
  const decoded = decodeAbiParameters(abi, data)
  if (!same(encodeAbiParameters(abi, decoded as never), data)) throw new Error('Noncanonical parameters')
  return decoded
}
function sweep(data: Hex, sender: string): boolean {
  const [token, recipient, minimum] = params(SWEEP, data)
  return same(token, ZERO) && same(recipient, sender) && minimum === 0n
}
function v3Path(encoded: Hex): V3Route | null {
  if (encoded.length !== 88) return null // Exactly one address/uint24/address hop.
  const tokenIn = encoded.slice(0, 42), tokenOut = `0x${encoded.slice(48)}`
  const fee = Number.parseInt(encoded.slice(42, 48), 16)
  if (same(tokenIn, ZERO) || same(tokenOut, ZERO) || same(tokenIn, tokenOut) || fee >= 1_000_000) return null
  return { protocol: 'v3', tokenIn, tokenOut, fee }
}
function v3(commands: Hex, inputs: readonly Hex[], sender: string, value: bigint): V3Route | null {
  const nativeIn = commands === '0x0b000c04' && inputs.length === 4
  const nativeOut = commands === '0x000c04' && inputs.length === 3
  const tokens = commands === '0x00' && inputs.length === 1
  if (!nativeIn && !nativeOut && !tokens) return null
  const [recipient, amount, minimum, path, payer, minHop] = params(V3_SWAP, inputs[nativeIn ? 1 : 0])
  const route = v3Path(path)
  if (!route || !positive(amount) || minimum <= 0n || minHop.length !== 0) return null
  if (tokens) return value === 0n && same(recipient, sender) && payer ? route : null
  const [unwrapRecipient, unwrapMinimum] = params(PAIR, inputs[nativeIn ? 2 : 1])
  if (!sweep(inputs[nativeIn ? 3 : 2], sender) || !same(unwrapRecipient, sender) || unwrapMinimum !== (nativeIn ? 0n : minimum)) return null
  if (nativeIn) {
    const [wrapRecipient, wrapAmount] = params(PAIR, inputs[0])
    return same(route.tokenIn, deployment.wrappedNative) && same(wrapRecipient, ROUTER_CUSTODY) && wrapAmount === amount && value === amount && same(recipient, sender) && !payer ? route : null
  }
  return same(route.tokenOut, deployment.wrappedNative) && value === 0n && same(recipient, ROUTER_CUSTODY) && payer ? route : null
}
function v4(inputs: readonly Hex[], sender: string, value: bigint): V4Route | null {
  if (inputs.length !== 2 || !sweep(inputs[1], sender)) return null
  const [actions, inner] = params(ACTIONS, inputs[0])
  if (actions !== '0x060c0f' || inner.length !== 3) return null
  const [swap] = params(V4_SWAP, inner[0])
  const key = swap.poolKey
  const [settleToken, settleAmount] = params(PAIR, inner[1])
  const [takeToken, takeMinimum] = params(PAIR, inner[2])
  const input = swap.zeroForOne ? key.currency0 : key.currency1
  const output = swap.zeroForOne ? key.currency1 : key.currency0
  if (BigInt(key.currency0) >= BigInt(key.currency1) || key.fee > 1_000_000 || key.tickSpacing <= 0 || key.tickSpacing > 32767 || !same(key.hooks, ZERO) ||
    !positive(swap.amountIn) || swap.amountOutMinimum <= 0n || swap.minHopPriceX36 !== 0n || swap.hookData !== '0x' ||
    !same(settleToken, input) || settleAmount !== swap.amountIn || !same(takeToken, output) || takeMinimum !== swap.amountOutMinimum ||
    value !== (same(input, ZERO) ? swap.amountIn : 0n)) return null
  return { protocol: 'v4', key }
}

/** Canonical, single-hop own-adapter execution with all proceeds/refunds bound to sender. */
export function tradeRoute(data: Hex, sender: string, value: bigint): PoolReference | null {
  try {
    const decoded = decodeFunctionData({ abi: EXECUTE, data })
    if (!same(encodeFunctionData({ abi: EXECUTE, functionName: decoded.functionName, args: decoded.args }), data)) return null
    const [commands, inputs, deadline] = decoded.args
    if (deadline <= 0n) return null
    return commands === '0x1004' ? v4(inputs, sender, value) : v3(commands, inputs, sender, value)
  } catch { return null }
}
