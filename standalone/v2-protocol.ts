import { parseAbi, type Address } from 'viem'
import deployment from '../deployments/xlayer-test/active.json'

// Canonical Uniswap V2 TEST deployments, verified against locked upstream artifacts.
export const V2 = {
  factory: deployment.contracts.v2Factory as Address,
  router: deployment.contracts.v2Router as Address,
  wrapped: deployment.wrappedNative as Address,
  fee: 3000,
} as const
// This legacy TEST launch token charges 1% on transfers through its graduated pair.
// Router02's standard quote is gross pool output, not this token's net receipt.
// Exclusion is not a general ERC-20 security certification or fee-on-transfer support.
const NON_STANDARD_TEST_ASSETS = new Set(['0xc9e6cfefb3433b1b46d3fa61e096abb519ffe7e0'])
export const v2StandardAssets = (...addresses: string[]): boolean =>
  addresses.every(address => !NON_STANDARD_TEST_ASSETS.has(address.toLowerCase()))
export const V2_FACTORY = parseAbi([
  'function getPair(address,address) view returns(address)',
  'function allPairs(uint256) view returns(address)',
  'function allPairsLength() view returns(uint256)',
  'function feeTo() view returns(address)',
  'event PairCreated(address indexed token0,address indexed token1,address pair,uint256 count)',
])
export const V2_PAIR = parseAbi([
  'function factory() view returns(address)', 'function token0() view returns(address)',
  'function token1() view returns(address)', 'function getReserves() view returns(uint112,uint112,uint32)',
  'function totalSupply() view returns(uint256)', 'function kLast() view returns(uint256)',
  'function balanceOf(address) view returns(uint256)',
])
export const V2_ROUTER_READ = parseAbi([
  'function factory() view returns(address)', 'function WETH() view returns(address)',
  'function getAmountsOut(uint256,address[]) view returns(uint256[])',
  'function getAmountsIn(uint256,address[]) view returns(uint256[])',
])
export const V2_ROUTER = parseAbi([
  'function addLiquidity(address tokenA,address tokenB,uint256 amountADesired,uint256 amountBDesired,uint256 amountAMin,uint256 amountBMin,address to,uint256 deadline) returns(uint256,uint256,uint256)',
  'function addLiquidityETH(address token,uint256 amountTokenDesired,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) payable returns(uint256,uint256,uint256)',
  'function removeLiquidity(address tokenA,address tokenB,uint256 liquidity,uint256 amountAMin,uint256 amountBMin,address to,uint256 deadline) returns(uint256,uint256)',
  'function removeLiquidityETH(address token,uint256 liquidity,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) returns(uint256,uint256)',
  'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns(uint256[])',
  'function swapExactETHForTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable returns(uint256[])',
  'function swapExactTokensForETH(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns(uint256[])',
  'function swapTokensForExactTokens(uint256 amountOut,uint256 amountInMax,address[] path,address to,uint256 deadline) returns(uint256[])',
  'function swapETHForExactTokens(uint256 amountOut,address[] path,address to,uint256 deadline) payable returns(uint256[])',
  'function swapTokensForExactETH(uint256 amountOut,uint256 amountInMax,address[] path,address to,uint256 deadline) returns(uint256[])',
])
// ERC20 Transfer has a different indexed layout from an NFT Transfer. Keep separate.
export const V2_PAIR_EVENTS = parseAbi([
  'event Mint(address indexed sender,uint256 amount0,uint256 amount1)',
  'event Burn(address indexed sender,uint256 amount0,uint256 amount1,address indexed to)',
  'event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)',
  'event Sync(uint112 reserve0,uint112 reserve1)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
])
