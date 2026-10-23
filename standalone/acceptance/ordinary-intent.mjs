// Acceptance-only matching. No signer, network, or mutable state lives here.
import { createRequire } from 'node:module'
const require = createRequire(new URL('../web/package.json', import.meta.url))
const { parseAbi, decodeFunctionData, encodeFunctionData } = require('viem')
const signatures = [
  'function multicall(bytes[]) payable returns(bytes[])',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns(uint256,uint128,uint256,uint256)',
  'function increaseLiquidity((uint256 tokenId,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns(uint128,uint256,uint256)',
  'function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns(uint256,uint256)',
  'function modifyLiquidities(bytes,uint256) payable',
  'function execute(bytes,bytes[],uint256) payable',
  'function approve(address,address,uint160,uint48)',
]
const abi = parseAbi(signatures)
const dynamic = new Set(['0xac9650d8','0x88316456','0x219f5d17','0x0c49ccbe','0xdd46508f','0x3593564c','0x87517c45'])
export function canonicalIntentData(data, now, checkTime = true, depth = 0) {
  if (depth > 3 || typeof data !== 'string' || !/^0x(?:[a-f0-9]{2})+$/i.test(data)) throw Error('Invalid acceptance calldata')
  if (!dynamic.has(data.slice(0,10).toLowerCase())) return data.toLowerCase()
  const decoded = decodeFunctionData({ abi, data }), args = [...decoded.args]
  if (encodeFunctionData({ abi, functionName: decoded.functionName, args }).toLowerCase() !== data.toLowerCase()) throw Error('Noncanonical acceptance calldata')
  const expiry = value => {
    if (checkTime && (value <= now || value > now + 600n)) throw Error('Acceptance deadline outside ten minutes')
    return 0n
  }
  if (decoded.functionName === 'multicall') args[0] = args[0].map(call => canonicalIntentData(call, now, checkTime, depth + 1))
  else if (['mint','increaseLiquidity','decreaseLiquidity'].includes(decoded.functionName)) args[0] = { ...args[0], deadline: expiry(args[0].deadline) }
  else if (decoded.functionName === 'modifyLiquidities') args[1] = expiry(args[1])
  else if (decoded.functionName === 'execute') args[2] = expiry(args[2])
  else if (decoded.functionName === 'approve') args[3] = expiry(BigInt(args[3]))
  return encodeFunctionData({ abi, functionName: decoded.functionName, args }).toLowerCase()
}
export function assertNextIntent(tx, step, owner, now) {
  if (!tx || !step || Object.keys(tx).some(key => !['from','to','data','value','chainId','gas'].includes(key)) ||
      tx.from?.toLowerCase() !== owner.toLowerCase() || tx.to?.toLowerCase() !== step.to.toLowerCase() ||
      BigInt(tx.chainId ?? 0) !== 196n || BigInt(tx.value ?? 0) !== BigInt(step.value) ||
      canonicalIntentData(tx.data, now) !== canonicalIntentData(step.data, 0n, false)) throw Error('Wallet intent differs from the next rehearsed transaction')
}
export function assertAcceptanceBudget(state, step, price, caps) {
  const gas = BigInt(state.gasSpentWei) + BigInt(step.plannedGasLimit) * price
  const native = BigInt(state.nonGasSpentWei) + BigInt(step.value)
  const token = BigInt(state.fabSpentRaw) + BigInt(step.maximumFabSpendRaw)
  if (price <= 0n || price > BigInt(caps.maxGasPriceWei) || gas > BigInt(caps.gasCapWei) || native > BigInt(caps.nonGasCapWei) || gas + native > BigInt(caps.totalCapWei) || token > BigInt(caps.maxTestTokenApprovalsRaw)) throw Error('Approved cumulative budget stops transaction')
}
export function assertAcceptanceProgress(state, plan, nonce, pendingNonce) {
  if (state.pending || state.stopped || state.rows.some(row => row.status !== 'success') || state.rows.length > plan.rows.length) throw Error('Pending, uncertain or failed transaction: reconcile, never replay')
  if (nonce !== plan.startNonce + state.rows.length || pendingNonce !== nonce) throw Error('Final signer nonce changed')
}
