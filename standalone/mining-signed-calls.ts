import { encodeAbiParameters, parseAbiParameters, type Hex } from 'viem'
import { isMiningTestDeployment, type MiningAddress, type MiningProductDeployment } from './mining-products'

/** The already approved 1952 product parameters; production must use a separate policy. */
export const MINING_LAUNCH_TEST_POLICY = {
  graduation: 5000n * 100_000_000n,
  buyFeeBps: 100, sellFeeBps: 100, taxBuyBps: 100, taxSellBps: 100,
  snipeStartBps: 0, snipeMins: 0, listingFee: 0n, firstBuy: 0n,
  founderBps: 0, founderSecs: 0,
  founderRoot: `0x${'0'.repeat(64)}` as Hex,
  venue: 1, graduationProtectionSecs: 86400n,
} as const

export interface MiningLaunchForm { name: string; symbol: string; metadataURI: string }
export interface MiningCreateParams extends MiningLaunchForm {
  salt: Hex; quote: MiningAddress; graduation: bigint
  buyFeeBps: number; sellFeeBps: number; taxBuyBps: number; taxSellBps: number
  snipeStartBps: number; snipeMins: number; listingFee: bigint; firstBuy: bigint
  founderBps: number; founderSecs: number; founderRoot: Hex
}
export interface MiningPurchase {
  listingId: bigint; minerId: bigint; nativePrice: bigint; maxFab: bigint; nonce: bigint; deadline: bigint
}
export interface MiningConversion { input: bigint; minimumFab: bigint; nonce: bigint; deadline: bigint }

const uint256 = (v: unknown): v is bigint => typeof v === 'bigint' && v >= 0n && v < (1n << 256n)
const positive = (v: unknown): v is bigint => uint256(v) && v > 0n
const signature = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-fA-F]{130}$/.test(v)
const nonzeroSalt = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v) && !/^0x0{64}$/.test(v)
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const sameAddress = (v: unknown, expected: string): boolean => typeof v === 'string' && v.toLowerCase() === expected.toLowerCase()
const utf8Length = (v: string): number => new TextEncoder().encode(v).length
const hasAsciiControl = (v: string): boolean => Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
const deadline = (v: unknown, now: number, seconds: number): boolean =>
  uint256(v) && v >= BigInt(now) && v <= BigInt(now + seconds)

function validLaunchForm(v: unknown): v is MiningLaunchForm {
  if (!record(v) || typeof v.name !== 'string' || !v.name.startsWith('TEST ') ||
      hasAsciiControl(v.name) || v.name.trim() !== v.name || v.name.length <= 5 || utf8Length(v.name) > 64 ||
      typeof v.symbol !== 'string' || !/^TEST-[A-Z0-9-]{1,20}$/.test(v.symbol) ||
      typeof v.metadataURI !== 'string' || utf8Length(v.metadataURI) > 256) return false
  if (v.metadataURI === '') return true
  if (/\s/.test(v.metadataURI) || hasAsciiControl(v.metadataURI)) return false
  try {
    const uri = new URL(v.metadataURI)
    return ['https:', 'ipfs:'].includes(uri.protocol) && uri.hostname.length > 0 && !uri.username && !uri.password
  } catch { return false }
}

/** Normalize only user-controlled presentation fields. Invalid input never produces calldata. */
export function normalizeMiningLaunchForm(form: MiningLaunchForm): MiningLaunchForm {
  if (hasAsciiControl(form.name)) throw new Error('miningInvalidLaunch')
  const name = form.name.trim(), symbol = form.symbol.trim().toUpperCase()
  const result = { name: name.startsWith('TEST ') ? name : `TEST ${name}`,
    symbol: symbol.startsWith('TEST-') ? symbol : `TEST-${symbol}`, metadataURI: form.metadataURI.trim() }
  if (!validLaunchForm(result)) throw new Error('miningInvalidLaunch')
  return result
}

export function miningLaunchVaultData(): Hex {
  return encodeAbiParameters(parseAbiParameters('uint16,uint16,uint16,uint16'), [100, 100, 100, 0])
}

export function miningCreateParams(form: MiningLaunchForm, salt: Hex, d: MiningProductDeployment): MiningCreateParams {
  if (!isMiningTestDeployment(d) || !nonzeroSalt(salt)) throw new Error('miningInvalidLaunch')
  const { venue: _venue, graduationProtectionSecs: _protection, ...parameters } = MINING_LAUNCH_TEST_POLICY
  return { ...normalizeMiningLaunchForm(form), ...parameters, salt, quote: d.contracts.fab.address }
}

function validCreate(args: readonly unknown[], d: MiningProductDeployment, now: number): boolean {
  const [p, templateId, vaultData, expiry, factory, venue, protection, sig] = args
  if (args.length !== 8 || !record(p) || !validLaunchForm(p) || !nonzeroSalt(p.salt) ||
      !sameAddress(p.quote, d.contracts.fab.address) || templateId !== d.templateId ||
      typeof vaultData !== 'string' || vaultData.toLowerCase() !== miningLaunchVaultData() ||
      !deadline(expiry, now, 3600) || !sameAddress(factory, d.contracts.miningFactory.address) ||
      venue !== MINING_LAUNCH_TEST_POLICY.venue || protection !== MINING_LAUNCH_TEST_POLICY.graduationProtectionSecs || !signature(sig)) return false
  const { venue: _venue, graduationProtectionSecs: _protection, ...parameters } = MINING_LAUNCH_TEST_POLICY
  return Object.entries(parameters).every(([field, expected]) => p[field] === expected)
}

/** Shape/policy validation only. Signatures, nonce freshness and live bindings require chain reads. */
export function validMiningSignedCall(role: string, name: string, args: readonly unknown[], d: MiningProductDeployment, now: number): boolean | undefined {
  if (name === 'createToken') return isMiningTestDeployment(d) && role === 'manager' && validCreate(args, d, now)
  if (name !== 'buyMiner' && name !== 'convertTax') return undefined
  const [p, sig] = args
  if (!isMiningTestDeployment(d) || args.length !== 2 || !record(p) || !signature(sig) ||
      !uint256(p.nonce) || !deadline(p.deadline, now, 60)) return false
  return name === 'buyMiner' ? role === 'farm' && uint256(p.listingId) && uint256(p.minerId) &&
    positive(p.nativePrice) && positive(p.maxFab) : role === 'projectVault' && positive(p.input) && positive(p.minimumFab)
}
