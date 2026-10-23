import { parseAbi } from 'viem'
export const tokenAbi = parseAbi([
  'function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)', 'function decimals() view returns(uint8)',
])
export const poolAbi = parseAbi([
  'function PRODUCT_VERSION() view returns(bytes32)', 'function REWARDS() view returns(address)',
  'function INCOME() view returns(address)', 'function FAB() view returns(address)',
  'function VAULT() view returns(address)', 'function POLICY() view returns(address)', 'function totalSupply() view returns(uint256)',
  'function reserveShares() view returns(uint256)', 'function reserveOkb() view returns(uint256)',
  'function quote(bool,uint256) view returns(uint256,uint256,uint256)',
  'function addLiquidity(uint256,uint256,uint256,uint256) payable returns(uint256)',
  'function removeLiquidity(uint256,uint256,uint256,uint256) returns(uint256,uint256)',
  'function swap(bool,uint256,uint256,uint256) payable returns(uint256)',
  'event Swapped(address indexed account,bool shareIn,uint256 input,uint256 output,uint256 platformFee,uint256 lpFee)',
  'event LiquidityAdded(address indexed account,uint256 shares,uint256 okb,uint256 liquidity)',
  'event LiquidityRemoved(address indexed account,uint256 shares,uint256 okb,uint256 liquidity)',
])
export const lpRewardsAbi = parseAbi(['function POOL() view returns(address)', 'function claimFor(address) returns(uint256,uint256)', 'function claimable(address) view returns(uint256,uint256)'])
/** IGNIX MirrorVault reads used by the epoch pool. Views only: miners, redemptions and claims live in IGNIX. */
export const mirrorVaultAbi = parseAbi([
  'function LP_POOL() view returns(address)', 'function LP_REWARDS_VERSION() view returns(bytes32)', 'function POLICY() view returns(address)',
  'function totalEligibleWeight() view returns(uint256)', 'function claimable(address) view returns(uint256)',
])
export const ignixIncomeAbi = parseAbi([
  'function POOL() view returns(address)', 'function FAB() view returns(address)', 'function RECIPIENT() view returns(address)',
])
