import { parseAbi } from 'viem'
export const tokenAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
])
export const factoryAbi = parseAbi([
  'function getPool(address,address,uint24) view returns (address)',
  'function feeAmountTickSpacing(uint24) view returns (int24)',
])
export const poolAbi = parseAbi([
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
  'function liquidity() view returns (uint128)',
  'function feeGrowthGlobal0X128() view returns (uint256)',
  'function feeGrowthGlobal1X128() view returns (uint256)',
  'function ticks(int24) view returns (uint128,int128,uint256,uint256,int56,uint160,uint32,bool)',
])
export const nftAbi = parseAbi([
  'function ownerOf(uint256) view returns (address)',
  'function safeTransferFrom(address,address,uint256)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
])
export const v3ManagerAbi = parseAbi([
  'function burn(uint256) payable',
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function positions(uint256) view returns (uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)',
  'function multicall(bytes[]) payable returns (bytes[])',
  'function refundETH() payable',
  'function unwrapWETH9(uint256,address) payable',
  'function sweepToken(address,uint256,address) payable',
  'function createAndInitializePoolIfNecessary(address,address,uint24,uint160) payable returns (address)',
  'function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) payable returns (uint256,uint128,uint256,uint256)',
  'function increaseLiquidity((uint256 tokenId,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns (uint128,uint256,uint256)',
  'function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) payable returns (uint256,uint256)',
  'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) payable returns (uint256,uint256)',
])
export const v4ManagerAbi = parseAbi([
  'function getPoolAndPositionInfo(uint256) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint256)',
  'function getPositionLiquidity(uint256) view returns (uint128)',
  'function multicall(bytes[]) payable returns (bytes[])',
  'function initializePool((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint160) payable returns (int24)',
  'function modifyLiquidities(bytes,uint256) payable',
])
export const stateAbi = parseAbi([
  'function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)',
  'function getLiquidity(bytes32) view returns (uint128)',
  'function getFeeGrowthInside(bytes32,int24,int24) view returns (uint256,uint256)',
  'function getPositionInfo(bytes32,address,int24,int24,bytes32) view returns (uint128,uint256,uint256)',
])
export const permitAbi = parseAbi([
  'function allowance(address,address,address) view returns (uint160,uint48,uint48)',
  'function approve(address,address,uint160,uint48)',
])
export const keyType = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
} as const
