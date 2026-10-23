import { V2 } from '../../v2-protocol'
import { v2Request } from './v2-requests'
import { decodeFunctionData, encodeFunctionData, parseAbi, type Hex } from 'viem'
import deployment from '../../../deployments/xlayer-test/active.json'
import { publicSwapsEnabled } from '../../trading-policy'
import { contractReadKind } from './contract-reads'
import { validLiquidityRequest } from './lp-requests'
import { tradeRoute } from './trade-routes'
import { validOrderRequest } from './order-requests'

const ZERO = '0x0000000000000000000000000000000000000000'
const ROUTER = deployment.contracts.universalRouter.toLowerCase()
const PERMIT2 = deployment.permit2.toLowerCase()
const WOKB = deployment.wrappedNative.toLowerCase()
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const DATA = /^0x(?:[0-9a-fA-F]{2})*$/
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/
const ERC20 = parseAbi(['function approve(address spender,uint256 amount)', 'function allowance(address owner,address spender) view returns (uint256)'])
const PERMITS = parseAbi(['function allowance(address owner,address token,address spender) view returns (uint160,uint48,uint48)', 'function approve(address token,address spender,uint160 amount,uint48 expiration)'])
const WRAPPED = parseAbi(['function deposit() payable', 'function withdraw(uint256 amount)'])
const TRANSFER = parseAbi(['function transfer(address recipient,uint256 amount) returns(bool)'])

function same(a: string, b: string): boolean { return a.toLowerCase() === b.toLowerCase() }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function positive(value: bigint): boolean { return value > 0n && value < 2n ** 160n - 1n }
/** Reads and canonical simulations for active SodaDEX adapters; never broadcasting. */
export function validContractRequest(value: unknown, simulation: boolean): boolean {
  if (!record(value) || Object.keys(value).some((key) => !['from', 'to', 'data', 'value'].includes(key)) ||
    typeof value.to !== 'string' || !ADDRESS.test(value.to) || typeof value.data !== 'string' || !DATA.test(value.data) ||
    (value.from !== undefined && (typeof value.from !== 'string' || !ADDRESS.test(value.from))) ||
    (value.value !== undefined && (typeof value.value !== 'string' || !QUANTITY.test(value.value)))) return false
  const to = value.to.toLowerCase(), data = value.data as Hex
  const amount = BigInt((value.value as string | undefined) ?? '0x0')
  try {
    if (validOrderRequest(to, data, value.from as string | undefined, amount, simulation)) return true
    if (typeof value.from === 'string' && to !== ZERO) {
      if (data === '0x' && amount > 0n && amount < 2n ** 256n) return true
      if (amount === 0n) {
        try {
          const decoded = decodeFunctionData({ abi: TRANSFER, data })
          if (same(encodeFunctionData({ abi: TRANSFER, functionName: decoded.functionName, args: decoded.args }), data) && !same(decoded.args[0], ZERO) && decoded.args[1] > 0n) return true
        } catch { /* Other selectors continue through the existing contract boundary. */ }
      }
    }
    const v2 = v2Request(to, data, value.from as string | undefined, amount)
    if (v2) return v2.kind !== 'swap' || publicSwapsEnabled()
    if (!simulation && amount === 0n && contractReadKind(to, data)) return true
    if (typeof value.from === 'string' && validLiquidityRequest(to, data, value.from, amount)) return true
    if (to !== PERMIT2 && to !== ZERO && amount === 0n) {
      try {
        const approval = decodeFunctionData({ abi: ERC20, data })
        if (approval.functionName === 'approve' && same(encodeFunctionData({ abi: ERC20, functionName: approval.functionName, args: approval.args }), data) && typeof value.from === 'string' &&
          [PERMIT2, deployment.contracts.v3PositionManager.toLowerCase(), V2.router.toLowerCase()].includes(approval.args[0].toLowerCase()) && (approval.args[1] === 0n || positive(approval.args[1]))) return true
      } catch { /* Other selectors continue through the protocol-specific boundary. */ }
    }
    if (to === WOKB && typeof value.from === 'string') {
      try {
        const decoded = decodeFunctionData({ abi: WRAPPED, data })
        if (same(encodeFunctionData({ abi: WRAPPED, functionName: decoded.functionName, args: decoded.args }), data)) {
          return decoded.functionName === 'deposit' ? positive(amount) : amount === 0n && positive(decoded.args[0])
        }
      } catch { /* Non-wrapping selectors continue through the contract boundary. */ }
    }
    if (to === PERMIT2 && amount === 0n) {
      const decoded = decodeFunctionData({ abi: PERMITS, data })
      if (!same(encodeFunctionData({ abi: PERMITS, functionName: decoded.functionName, args: decoded.args }), data)) return false
      if (decoded.functionName === 'allowance') return !simulation && (same(decoded.args[2], ROUTER) || same(decoded.args[2], deployment.contracts.v4PositionManager))
      if (typeof value.from === 'string' && same(decoded.args[1], deployment.contracts.v4PositionManager)) return decoded.args[2] === 0n || (positive(decoded.args[2]) && decoded.args[3] > 0)
      if (same(decoded.args[0], ZERO)) return false
      if (typeof value.from === 'string' && same(decoded.args[1], ROUTER) && decoded.args[2] === 0n) return true
      return publicSwapsEnabled() && typeof value.from === 'string' && same(decoded.args[1], ROUTER) && positive(decoded.args[2]) && decoded.args[3] > 0 && decoded.args[3] < 2 ** 48 - 1
    }
    return publicSwapsEnabled() && to === ROUTER && typeof value.from === 'string' && tradeRoute(data, value.from, amount) !== null
  } catch { return false }
}
