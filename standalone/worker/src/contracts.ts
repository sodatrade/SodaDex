import { parseAbi } from 'viem'
import deployment from '../../../deployments/xlayer-test/active.json'
import pools from '../../../deployments/xlayer-test/pools.json'

export { deployment, pools }
export interface PoolKey { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }
export type PoolReference = { protocol: 'v3'; tokenIn: string; tokenOut: string; fee: number } | { protocol: 'v4'; key: PoolKey }
export const ZERO = '0x0000000000000000000000000000000000000000'
export const FIRST_BLOCK = 73361037 // First canonical receipt in receipts.json; never scan before deployment.
export const PAGE_BLOCKS = 2000
export const MAX_EVENTS = 20 // Bounds transaction lookups to stay within a Worker request's subrequest budget.
export const ERC20_READ = parseAbi([
  'function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)',
])
export const FACTORY_READ = parseAbi(['function getPool(address,address,uint24) view returns(address)', 'function feeAmountTickSpacing(uint24) view returns(int24)'])
export const V3_POOL_READ = parseAbi([
  'function factory() view returns(address)', 'function token0() view returns(address)', 'function token1() view returns(address)',
  'function fee() view returns(uint24)', 'function tickSpacing() view returns(int24)', 'function liquidity() view returns(uint128)',
  'function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)',
  'function feeGrowthGlobal0X128() view returns(uint256)', 'function feeGrowthGlobal1X128() view returns(uint256)',
  'function ticks(int24) view returns(uint128,int128,uint256,uint256,int56,uint160,uint32,bool)',
])
export const NFT_READ = parseAbi([
  'function balanceOf(address) view returns(uint256)', 'function ownerOf(uint256) view returns(address)',
  'function tokenURI(uint256) view returns(string)', 'function getApproved(uint256) view returns(address)',
  'function isApprovedForAll(address,address) view returns(bool)',
])
export const V3_POSITION_READ = [...NFT_READ, ...parseAbi([
  'function tokenOfOwnerByIndex(address,uint256) view returns(uint256)',
  'function positions(uint256) view returns(uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)',
])] as const
export const V4_POSITION_READ = [...NFT_READ, ...parseAbi([ 'function nextTokenId() view returns(uint256)', 'function getPositionLiquidity(uint256) view returns(uint128)',
  'function getPoolAndPositionInfo(uint256) view returns((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint256)',
])] as const
export const STATE_READ = parseAbi([
  'function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)', 'function getLiquidity(bytes32) view returns(uint128)',
  'function getFeeGrowthInside(bytes32,int24,int24) view returns(uint256,uint256)',
  'function getPositionInfo(bytes32,address,int24,int24,bytes32) view returns(uint128,uint256,uint256)',
])
export const EVENTS = parseAbi([
  'event PoolCreated(address indexed token0,address indexed token1,uint24 indexed fee,int24 tickSpacing,address pool)',
  'event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)',
  'event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)',
  'event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
  'event IncreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
  'event DecreaseLiquidity(uint256 indexed tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)',
  'event Collect(uint256 indexed tokenId,address recipient,uint256 amount0,uint256 amount1)',
  'event ModifyLiquidity(bytes32 indexed id,address indexed sender,int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt)',
])
export function same(a: string, b: string): boolean { return a.toLowerCase() === b.toLowerCase() }
export function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
