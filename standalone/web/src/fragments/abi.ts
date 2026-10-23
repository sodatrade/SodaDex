import { parseAbi } from 'viem'
export const tokenAbi = parseAbi([
  'function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)', 'function decimals() view returns(uint8)',
])
export const poolAbi = parseAbi([
  'function PRODUCT_VERSION() view returns(bytes32)', 'function REWARDS() view returns(address)',
  'function INCOME() view returns(address)', 'function FAB() view returns(address)',
  'function VAULT() view returns(address)', 'function POLICY() view returns(address)', 'function totalSupply() view returns(uint256)',
  'function SHARES() view returns(address)',
  'function reserveShares() view returns(uint256)', 'function reserveOkb() view returns(uint256)',
  'function quote(bool,uint256) view returns(uint256,uint256,uint256)',
  'function addLiquidity(uint256,uint256,uint256,uint256) payable returns(uint256)',
  'function removeLiquidity(uint256,uint256,uint256,uint256) returns(uint256,uint256)',
  'function swap(bool,uint256,uint256,uint256) payable returns(uint256)',
  'event Swapped(address indexed account,bool shareIn,uint256 input,uint256 output,uint256 platformFee,uint256 lpFee)',
  'event LiquidityAdded(address indexed account,uint256 shares,uint256 okb,uint256 liquidity)',
  'event LiquidityRemoved(address indexed account,uint256 shares,uint256 okb,uint256 liquidity)',
])
export const lpRewardsAbi = parseAbi(['function POOL() view returns(address)', 'function INCENTIVE_SOURCE() view returns(address)', 'function claimFor(address) returns(uint256,uint256)', 'function claimable(address) view returns(uint256,uint256)'])
/** IGNIX MirrorVault reads used by the epoch pool. Views only: miners, redemptions and claims live in IGNIX. */
export const mirrorVaultAbi = parseAbi([
  'function LP_POOL() view returns(address)', 'function LP_REWARDS_VERSION() view returns(bytes32)', 'function POLICY() view returns(address)',
  'function totalEligibleWeight() view returns(uint256)', 'function claimable(address) view returns(uint256)',
  'function FABS() view returns(address)', 'function lockedShares(address) view returns(uint256)',
  'function openEpoch() view returns(uint64)', 'function confirmedEpoch() view returns(uint64)',
  'function minerCount() view returns(uint256)', 'function heldIds(uint256,uint256) view returns(uint256[])',
])
/** Standalone FABS share token: ERC20 plus the vault it is bound to. */
export const fabsTokenAbi = parseAbi(['function vault() view returns(address)', 'function totalSupply() view returns(uint256)', 'function symbol() view returns(string)'])
export const ignixIncomeAbi = parseAbi([
  'function POOL() view returns(address)', 'function FAB() view returns(address)', 'function RECIPIENT() view returns(address)',
])
