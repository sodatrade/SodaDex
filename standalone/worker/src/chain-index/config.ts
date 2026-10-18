import { keccak256, parseAbi, stringToHex } from 'viem'
import { networkProfile, type NetworkProfileId } from '../../../network-profile'
import { MINING_PRODUCTS } from '../../../mining-products'
import { miningCatalog } from '../mining-api'
import { deployment, EVENTS, FIRST_BLOCK } from '../contracts'
import { knownPools } from '../dex-data'
import type { IndexConfig, IndexEnv, IndexSource } from './types'
// Mining events match the deployed IGNIX c5ab57dab8583a387a1b3499d183bd2e00e5855e sources.
const erc20 = ['event Transfer(address indexed from,address indexed to,uint256 value)', 'event Approval(address indexed owner,address indexed spender,uint256 value)']
const custody = ['event MinerAdmitted(uint256 indexed id,uint256 weight)', 'event MinerReleased(uint256 indexed id)', 'event MiningCollected(uint256 amount,uint256 eligibleWeight)']
const reward = ['event RewardsRecognised(uint256 amount,uint256 supply)', 'event RewardsPaid(address indexed account,uint256 amount)']
const abiByRole: Record<string, ReturnType<typeof parseAbi>> = {
  fab: parseAbi(erc20), projectToken: parseAbi(erc20), wrappedNative: parseAbi(erc20),
  circuits: parseAbi(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)', 'event Approval(address indexed owner,address indexed approved,uint256 indexed tokenId)', 'event ApprovalForAll(address indexed owner,address indexed operator,bool approved)', 'event TapedOut(uint256 indexed circuitId,address indexed author,uint32 gateCount,uint32 nState)']),
  mining: parseAbi(['event Started(bytes32 indexed key,address indexed circuits,uint256 indexed circuitId,uint32 taskId,address registrant,uint64 bstar,uint64 bonus,bool optimal,uint256 verifWeight,uint256 unverWeight,uint32 samplesChecked)',
    'event Demoted(bytes32 indexed key,address indexed circuits,uint256 circuitId,uint32 taskId)', 'event Reclaimed(bytes32 indexed key,uint32 indexed taskId,uint64 bonus)',
    'event Revoked(bytes32 indexed key,address indexed challenger,uint32 vectorIndex)', 'event Stopped(bytes32 indexed key,address indexed by)', 'event Claimed(bytes32 indexed key,address indexed to,uint256 amount)', 'event Synced(bytes32 indexed key,uint32 boostBps)']),
  circuitMarket: parseAbi(['event Listed(uint256 indexed id,address indexed seller,address indexed circuits,uint256 tokenId,uint256 price)', 'event Sold(uint256 indexed id,address indexed buyer,address indexed circuits,uint256 tokenId,uint256 paidToSeller,uint256 fee)',
    'event Delisted(uint256 indexed id,address indexed by,bool stale)', 'event PriceChanged(uint256 indexed id,uint256 price)', 'event Withdrawn(address indexed who,uint256 amount)']),
  launchFactory: parseAbi(['event TokenDeployed(address indexed token,address indexed manager,bytes32 salt)']),
  liquidityHelper: parseAbi(['event LiquidityAdded(address indexed token,address indexed provider,uint256 tokenAmount,uint256 quoteAmount,uint256 liquidity)', 'event LiquidityRemoved(address indexed token,address indexed provider,uint256 liquidity,uint256 tokenAmount,uint256 quoteAmount)']),
  v2Locker: parseAbi(['event V2Locked(address indexed pair,uint256 liquidity,uint256 baseline)', 'event V2FeesHarvested(address indexed pair,address indexed creator,uint256 burned,address currency0,uint256 amount0,address currency1,uint256 amount1)', 'event V2FeesClaimed(address indexed who,address indexed currency,uint256 amount)']),
  manager: parseAbi(['event TokenCreated(address indexed token,address indexed creator,address indexed quote,uint256 graduation,string metadataURI,address vault,address tracker,uint16 templateId)',
    'event GraduatedV2(address indexed token,address indexed pair,address vault,uint128 quoteInjected,uint128 tokenInjected)',
    'event Trade(address indexed token,address indexed trader,bool isBuy,uint256 grossQuoteAmount,uint256 netQuoteAmount,uint256 curveQuoteAmount,uint256 tokenAmount,uint256 platformFee,uint256 taxFee,uint128 collected)']),
  miningFactory: parseAbi(['event MiningProjectCreated(address indexed token,address indexed vault,address indexed tracker)', 'event FarmBound(address indexed farm)']),
  fragmentVault: parseAbi([...erc20, ...reward, ...custody, 'event Deposited(address indexed account,uint256 indexed id,uint256 weight,uint256 shares)', 'event Redeemed(address indexed account,uint256 indexed id,uint256 shares)']),
  fragmentPool: parseAbi([...erc20, ...reward, 'event LiquidityAdded(address indexed account,uint256 shares,uint256 fab,uint256 liquidity)',
    'event LiquidityRemoved(address indexed account,uint256 shares,uint256 fab,uint256 liquidity)', 'event Swapped(address indexed account,bool shareIn,uint256 input,uint256 output,uint256 platformFee,uint256 lpFee)', 'event PlatformPaid(uint256 shares,uint256 fab)']),
  farm: parseAbi([...custody, 'event ReceiverBound(address indexed vault,address indexed receiver)', 'event ProductionRecognised(uint256 amount,uint256 contribution)',
    'event FarmRewardsPaid(address indexed vault,address indexed receiver,uint256 amount)', 'event MinerPurchased(uint256 indexed listingId,uint256 indexed minerId,uint256 fabSpent)',
    'event VaultRegistered(address indexed vault)', 'event Contributed(address indexed vault,uint256 amount,uint256 contribution)']),
  projectVault: parseAbi(['event TaxConverted(uint256 input,uint256 fabReceived)', 'event TaxRecognised(uint256 amount,uint256 protocol,uint256 creator,uint256 farm)', 'event Paid(address indexed receiver,uint256 amount)', 'event FarmFunded(uint256 amount)']),
  holder: parseAbi(['event HolderWeightUpdated(address indexed account,uint256 weight)', 'event RewardsRecognised(uint256 amount,uint256 weight)', 'event RewardsPaid(address indexed account,uint256 amount)',
    'event BurnCreditCreated(uint256 indexed id,address indexed account,uint256 amount,uint64 expiresAt)', 'event BurnCreditExpired(uint256 indexed id,address indexed account,uint256 amount)']),
  pair: parseAbi([...erc20, 'event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)',
    'event Mint(address indexed sender,uint256 amount0,uint256 amount1)', 'event Burn(address indexed sender,uint256 amount0,uint256 amount1,address indexed to)', 'event Sync(uint112 reserve0,uint112 reserve1)']),
  minerBuyer: parseAbi(['event Purchased(address indexed buyer,uint256 indexed listingId,uint256 indexed minerId,uint256 price)']),
}
export function baseConfig(id: NetworkProfileId): IndexConfig {
  if (id === '196-test') return { profile: networkProfile(id), version: `dex-${deployment.sourceCommit}-${keccak256(stringToHex(JSON.stringify([FIRST_BLOCK, deployment.contracts.v3Factory, deployment.contracts.v3PositionManager, deployment.contracts.v4PoolManager, deployment.contracts.v4PositionManager]))).slice(2, 18)}`, fromBlock: FIRST_BLOCK,
    sources: [source(deployment.contracts.v3Factory, 'v3', 'factory', EVENTS), source(deployment.contracts.v3PositionManager, 'v3', 'position', EVENTS),
      source(deployment.contracts.v4PoolManager, 'v4', 'manager', EVENTS), source(deployment.contracts.v4PositionManager, 'v4', 'position', EVENTS),
      ...knownPools().filter(p => p.address).map(p => source(p.address!, 'v3', 'pool', EVENTS))] }
  if (MINING_PRODUCTS.state !== 'ready') throw Error('Mining deployment unavailable')
  return { profile: networkProfile(id), version: MINING_PRODUCTS.version, fromBlock: Number(MINING_PRODUCTS.genesisBlock), sources: miningSources(MINING_PRODUCTS) }
}
function source(address: string, protocol: IndexSource['protocol'], role: string, abi: IndexSource['abi']): IndexSource { return { address: address.toLowerCase(), protocol, role, abi } }
function miningSources(d: Extract<typeof MINING_PRODUCTS, { state: 'ready' }>): IndexSource[] {
  const result = Object.entries(d.contracts).flatMap(([role, identity]) => abiByRole[role] ? [source(identity.address, 'mining', role, abiByRole[role])] : [])
  for (const p of d.projects) for (const [role, identity] of [['projectToken', p.token], ['projectVault', p.vault], ['holder', p.holder], ['pair', p.pair]] as const)
    if (identity) result.push(source(identity.address, 'mining', role, abiByRole[role]))
  return result
}
export async function currentConfig(id: NetworkProfileId, env: IndexEnv): Promise<IndexConfig> {
  const config = baseConfig(id)
  if (id === '1952-mining-test') {
    const catalog = await miningCatalog(env.MINING_API, 'https://sodadex-preview.jsmsdx2025.workers.dev')
    if (catalog.state === 'ready') config.sources = miningSources(catalog)
  }
  return config
}
export const actorName = (config: IndexConfig): string => `sodadex-chain-index:${config.profile.chainId}:${config.version}`
