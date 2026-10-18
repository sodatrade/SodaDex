import savedDeployment from '../deployments/xlayer-1952/products.json'

export type MiningAddress = `0x${string}`
export type MiningHash = `0x${string}`
export const MINING_PRODUCT_ROLES = ['fab', 'mining', 'circuits', 'circuitMarket', 'nftFactory',
  'manager', 'launchFactory', 'registry', 'miningFactory', 'farm', 'router', 'v2Factory',
  'wrappedNative', 'v2Locker', 'liquidityHelper', 'fragmentVault', 'fragmentPool', 'minerBuyer'] as const
export type MiningProductRole = typeof MINING_PRODUCT_ROLES[number]
export interface MiningContractIdentity {
  address: MiningAddress
  runtimeKeccak256: MiningHash
  implementation?: { address: MiningAddress; runtimeKeccak256: MiningHash }
  beacon?: { address: MiningAddress; runtimeKeccak256: MiningHash; implementation: { address: MiningAddress; runtimeKeccak256: MiningHash } }
}
export interface MiningProject {
  token: MiningContractIdentity; vault: MiningContractIdentity; holder: MiningContractIdentity
  pair?: MiningContractIdentity
  symbol: string
}
export interface MiningProductDeployment {
  schemaVersion: 1
  chainId: 1952 | 196
  profileId?: '1952-mining-test' | '196-mining-test'
  state: 'ready'
  version: string
  sourceHistoryVersion: 2
  genesisBlock: string
  templateId: number
  contracts: Readonly<Record<MiningProductRole, MiningContractIdentity>>
  projects: readonly MiningProject[]
  testListingIds?: readonly string[]
}
export type MiningDeploymentState = MiningProductDeployment | { state: 'pending'; chainId: 1952 | 196; profileId?: '1952-mining-test' | '196-mining-test' }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function contract(value: unknown): value is MiningContractIdentity {
  return record(value) && typeof value.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value.address) &&
    !/^0x0{40}$/.test(value.address) && typeof value.runtimeKeccak256 === 'string' &&
    /^0x[0-9a-fA-F]{64}$/.test(value.runtimeKeccak256) && !/^0x0{64}$/.test(value.runtimeKeccak256)
}

/** Addresses come from a receipt-verified build artifact, never a URL or localStorage. */
export function parseMiningDeployment(value: unknown): MiningDeploymentState {
  if (!record(value) || value.schemaVersion !== 1 || ![1952, 196].includes(value.chainId as number) ||
      value.chainId === 196 && value.profileId !== '196-mining-test' ||
      value.chainId === 1952 && value.profileId !== undefined && value.profileId !== '1952-mining-test') throw new Error('Invalid mining deployment')
  if (value.state === 'pending') return { state: 'pending', chainId: value.chainId as 1952 | 196, ...(value.profileId ? { profileId: value.profileId as '1952-mining-test' | '196-mining-test' } : {}) }
  if (value.state !== 'ready' || value.sourceHistoryVersion !== 2 || typeof value.version !== 'string' ||
      !/^[a-zA-Z0-9._-]{1,80}$/.test(value.version) || typeof value.genesisBlock !== 'string' ||
      !/^(0|[1-9][0-9]*)$/.test(value.genesisBlock) || !Number.isSafeInteger(value.templateId) ||
      (value.templateId as number) < 0 || (value.templateId as number) > 65_535 || !record(value.contracts) ||
      !Array.isArray(value.projects)) throw new Error('Invalid mining deployment')
  const contracts = value.contracts
  if (value.testListingIds !== undefined && (!Array.isArray(value.testListingIds) ||
      value.testListingIds.some((id) => typeof id !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(id) || BigInt(id) >= (1n << 256n)))) throw new Error('Invalid test listings')
  if (MINING_PRODUCT_ROLES.some((role) => !contract(contracts[role]))) throw new Error('Incomplete mining deployment')
  const addresses = MINING_PRODUCT_ROLES.map((role) => (contracts[role] as MiningContractIdentity).address.toLowerCase())
  if (new Set(addresses).size !== addresses.length) throw new Error('Mining deployment roles collide')
  for (const project of value.projects) {
    if (!record(project) || !contract(project.token) || !contract(project.vault) || !contract(project.holder) ||
        (project.pair !== undefined && !contract(project.pair)) || typeof project.symbol !== 'string' ||
        !/^TEST-[A-Z0-9-]{1,20}$/.test(project.symbol)) throw new Error('Invalid mining project')
    for (const identity of [project.token, project.vault, project.holder, project.pair].filter(contract))
      addresses.push(identity.address.toLowerCase())
  }
  if (new Set(addresses).size !== addresses.length) throw new Error('Mining project roles collide')
  for (const role of ['mining', 'manager', 'nftFactory', 'circuitMarket'] as const) {
    if (!contract((contracts[role] as MiningContractIdentity).implementation)) throw new Error('Missing mining proxy implementation')
  }
  const beacon = (contracts.circuits as MiningContractIdentity).beacon
  if (!contract(beacon) || !contract(beacon.implementation)) throw new Error('Missing miner NFT beacon implementation')
  return value as unknown as MiningProductDeployment
}

export const MINING_PRODUCTS = parseMiningDeployment(savedDeployment)

/** 196 mining has no inherited addresses. Only an explicitly supplied deployment enables it. */
export function miningDeploymentForProfile(profileId: string, configured?: unknown): MiningDeploymentState {
  if (profileId === '1952-mining-test') return MINING_PRODUCTS
  if (profileId !== '196-mining-test') throw new Error('Not a mining profile')
  if (configured === undefined) return { state: 'pending', chainId: 196, profileId }
  const value = parseMiningDeployment(configured)
  if (value.chainId !== 196 || value.profileId !== profileId) throw new Error('Mining profile mismatch')
  return value
}
export function miningProfileId(d: Pick<MiningProductDeployment, 'chainId' | 'profileId'>): '1952-mining-test' | '196-mining-test' {
  if (d.chainId === 1952 && (!d.profileId || d.profileId === '1952-mining-test')) return '1952-mining-test'
  if (d.chainId === 196 && d.profileId === '196-mining-test') return d.profileId
  throw new Error('Mining profile mismatch')
}

export function isMiningTestDeployment(d: Pick<MiningProductDeployment, 'chainId' | 'profileId'>): boolean {
  return d.chainId === 1952 && (!d.profileId || d.profileId === '1952-mining-test') || d.chainId === 196 && d.profileId === '196-mining-test'
}
