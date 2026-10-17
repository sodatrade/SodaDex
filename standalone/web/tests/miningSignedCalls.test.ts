import { describe, expect, it } from 'vitest'
import { decodeFunctionData, encodeFunctionData, parseAbi, type Hex } from 'viem'
import { MINING_PRODUCT_READ_ABI, MINING_PRODUCT_WRITE_ABI } from '../../mining-abi'
import { miningAbi, validMiningProductCall, type MiningTransaction, type MiningWriteRole } from '../../mining-calls'
import type { MiningProductDeployment } from '../../mining-products'
import { MINING_LAUNCH_TEST_POLICY, miningCreateParams, miningLaunchVaultData, normalizeMiningLaunchForm,
  type MiningConversion, type MiningCreateParams, type MiningPurchase } from '../../mining-signed-calls'
import { miningTestAddress, miningTestDeployment, MINING_TEST_ACCOUNT } from './fixtures/miningProducts'

const now = 1_800_000_000
const salt = `0x${'a'.repeat(64)}` as Hex, sig = `0x${'1'.repeat(130)}` as Hex
const zero = `0x${'0'.repeat(64)}` as Hex
const form = { name: 'FAB Mining', symbol: 'fab', metadataURI: 'ipfs://bafytest/metadata.json' }
const purchase: MiningPurchase = { listingId: 1n, minerId: 2n, nativePrice: 1n, maxFab: 100_000_000n, nonce: 0n, deadline: BigInt(now + 60) }
const conversion: MiningConversion = { input: 100n, minimumFab: 1n, nonce: 0n, deadline: BigInt(now + 60) }

function write(d: MiningProductDeployment, role: MiningWriteRole, name: string, args: readonly unknown[]): MiningTransaction {
  return { from: MINING_TEST_ACCOUNT,
    to: role === 'projectVault' ? d.projects[0].vault.address : d.contracts[role as 'manager' | 'farm'].address,
    data: encodeFunctionData({ abi: miningAbi(role, 'write'), functionName: name, args }), value: '0x0' }
}
function launchArgs(d: MiningProductDeployment, p: MiningCreateParams = miningCreateParams(form, salt, d)): readonly unknown[] {
  return [p, d.templateId, miningLaunchVaultData(), BigInt(now + 3600), d.contracts.miningFactory.address, 1, 86400n, sig]
}
function validLaunch(d: MiningProductDeployment, args = launchArgs(d)): boolean {
  return validMiningProductCall(write(d, 'manager', 'createToken', args), d, true, now)
}

describe('1952 signed launch policy', () => {
  it('normalizes visible test branding and fixes all approved test fees and destinations', () => {
    const d = miningTestDeployment(), p = miningCreateParams(form, salt, d)
    expect(p).toEqual({ name: 'TEST FAB Mining', symbol: 'TEST-FAB', metadataURI: form.metadataURI,
      quote: d.contracts.fab.address, salt, graduation: 500_000_000_000n, buyFeeBps: 100, sellFeeBps: 100,
      taxBuyBps: 100, taxSellBps: 100, snipeStartBps: 0, snipeMins: 0, listingFee: 0n, firstBuy: 0n,
      founderBps: 0, founderSecs: 0, founderRoot: zero })
    expect(validLaunch(d)).toBe(true)
    expect(normalizeMiningLaunchForm({ name: ' TEST Mine ', symbol: ' test-fab ', metadataURI: '' }))
      .toEqual({ name: 'TEST Mine', symbol: 'TEST-FAB', metadataURI: '' })
    expect(MINING_LAUNCH_TEST_POLICY.venue).toBe(1)
  })
  it('keeps maximum UTF-8 form fields within the existing 2048-byte calldata limit', () => {
    const d = miningTestDeployment(), metadataURI = `https://example.test/${'a'.repeat(235)}`
    const p = miningCreateParams({ name: `TEST ${'矿'.repeat(19)}xx`, symbol: `TEST-${'A'.repeat(20)}`, metadataURI }, salt, d)
    expect(new TextEncoder().encode(p.name)).toHaveLength(64)
    expect(new TextEncoder().encode(p.metadataURI)).toHaveLength(256)
    const tx = write(d, 'manager', 'createToken', launchArgs(d, p))
    expect(tx.data.length).toBeLessThanOrEqual(4098)
    expect(validMiningProductCall(tx, d, true, now)).toBe(true)
  })
  it.each(['\n', '\r', '\r\n', '\t', '\0', '\x1b', '\x7f'])('rejects ASCII control characters in names before trimming or signing: %j', (control) => {
    const d = miningTestDeployment()
    for (const name of [`Mine${control}Other line`, `${control}Mine`, `Mine${control}`]) {
      expect(() => normalizeMiningLaunchForm({ ...form, name })).toThrow('miningInvalidLaunch')
      const p = { ...miningCreateParams(form, salt, d), name: `TEST ${name}` }
      expect(validLaunch(d, launchArgs(d, p))).toBe(false)
    }
  })
  it.each([
    { name: '', symbol: 'A', metadataURI: '' },
    { name: '矿'.repeat(20), symbol: 'A', metadataURI: '' },
    { name: 'Mine', symbol: 'A'.repeat(21), metadataURI: '' },
    { name: 'Mine', symbol: 'A B', metadataURI: '' },
    { name: 'Mine', symbol: 'A', metadataURI: 'http://example.test' },
    { name: 'Mine', symbol: 'A', metadataURI: 'javascript:alert(1)' },
    { name: 'Mine', symbol: 'A', metadataURI: 'https://' },
    { name: 'Mine', symbol: 'A', metadataURI: 'https://user:password@example.test' },
    { name: 'Mine', symbol: 'A', metadataURI: `ipfs://${'a'.repeat(250)}` },
  ])('rejects invalid presentation input before constructing calldata: %j', (bad) => {
    expect(() => normalizeMiningLaunchForm(bad)).toThrow('miningInvalidLaunch')
  })
  it.each([
    ['name', 'Uniswap'], ['symbol', 'FAB'], ['metadataURI', 'http://example.test'], ['salt', zero],
    ['quote', miningTestAddress(999)], ['graduation', 1n], ['buyFeeBps', 0], ['sellFeeBps', 0],
    ['taxBuyBps', 0], ['taxSellBps', 0], ['snipeStartBps', 1], ['snipeMins', 1],
    ['listingFee', 1n], ['firstBuy', 1n], ['founderBps', 1], ['founderSecs', 1], ['founderRoot', salt],
  ])('rejects changed launch parameter %s', (field, value) => {
    const d = miningTestDeployment(), p = { ...miningCreateParams(form, salt, d), [field]: value }
    expect(validLaunch(d, launchArgs(d, p))).toBe(false)
  })
  it.each([
    [1, 2], [2, '0x'], [3, BigInt(now - 1)], [3, BigInt(now + 3601)],
    [4, miningTestAddress(999)], [5, 0], [6, 0n], [7, `0x${'1'.repeat(128)}`],
  ])('rejects changed top-level launch argument %s', (index, value) => {
    const d = miningTestDeployment(), args = [...launchArgs(d)]; args[index as number] = value
    expect(validLaunch(d, args)).toBe(false)
  })
  it('requires a nonzero salt and the test chain even before building the parameters', () => {
    const d = miningTestDeployment()
    expect(() => miningCreateParams(form, zero, d)).toThrow('miningInvalidLaunch')
    expect(() => miningCreateParams(form, salt, { ...d, chainId: 196 } as unknown as MiningProductDeployment)).toThrow('miningInvalidLaunch')
  })
})

describe('canonical signed procurement and tax conversion', () => {
  it('allows bounded signed shapes only to the deployment farm and registered project vault', () => {
    const d = miningTestDeployment()
    for (const tx of [write(d, 'farm', 'buyMiner', [purchase, sig]), write(d, 'projectVault', 'convertTax', [conversion, sig])]) {
      expect(validMiningProductCall(tx, d, true, now)).toBe(true)
      expect(validMiningProductCall({ ...tx, to: miningTestAddress(999) }, d, true, now)).toBe(false)
      expect(validMiningProductCall({ ...tx, to: d.contracts.fragmentVault.address }, d, true, now)).toBe(false)
      expect(validMiningProductCall({ ...tx, data: `${tx.data}00` }, d, true, now)).toBe(false)
      expect(validMiningProductCall({ ...tx, value: '0x1' }, d, true, now)).toBe(false)
      expect(validMiningProductCall({ ...tx, chainId: 1952 }, d, true, now)).toBe(false)
      expect(validMiningProductCall(tx, { ...d, chainId: 196 } as unknown as MiningProductDeployment, true, now)).toBe(false)
      const other = { ...d, contracts: { ...d.contracts, farm: { ...d.contracts.farm, address: miningTestAddress(998) } }, projects: [] }
      expect(validMiningProductCall(tx, other, true, now)).toBe(false)
    }
  })
  it.each(['nativePrice', 'maxFab'] as const)('rejects a zero purchase %s', (field) => {
    const d = miningTestDeployment()
    expect(validMiningProductCall(write(d, 'farm', 'buyMiner', [{ ...purchase, [field]: 0n }, sig]), d, true, now)).toBe(false)
  })
  it.each(['input', 'minimumFab'] as const)('rejects a zero conversion %s', (field) => {
    const d = miningTestDeployment()
    expect(validMiningProductCall(write(d, 'projectVault', 'convertTax', [{ ...conversion, [field]: 0n }, sig]), d, true, now)).toBe(false)
  })
  it.each([BigInt(now - 1), BigInt(now + 61)])('rejects signatures outside the on-chain 60-second expiry bound: %s', (expiry) => {
    const d = miningTestDeployment()
    expect(validMiningProductCall(write(d, 'farm', 'buyMiner', [{ ...purchase, deadline: expiry }, sig]), d, true, now)).toBe(false)
    expect(validMiningProductCall(write(d, 'projectVault', 'convertTax', [{ ...conversion, deadline: expiry }, sig]), d, true, now)).toBe(false)
  })
  it('accepts full uint256 nonces without inventing a maxFab spending policy or claiming cryptographic verification', () => {
    const d = miningTestDeployment(), max = (1n << 256n) - 1n
    const tx = write(d, 'farm', 'buyMiner', [{ ...purchase, maxFab: max, nonce: max }, sig])
    expect(validMiningProductCall(tx, d, true, now)).toBe(true)
    // A fixed-length signature is only a shape check; the service and contract must verify its signer.
    const notASignature = `0x${'0'.repeat(130)}` as Hex
    expect(validMiningProductCall(write(d, 'projectVault', 'convertTax', [conversion, notASignature]), d, true, now)).toBe(true)
    expect(validMiningProductCall(write(d, 'farm', 'buyMiner', [purchase, `${sig}00`]), d, true, now)).toBe(false)
  })
  it('rejects noncanonical tuple offsets and trailing bytes for creation too', () => {
    const d = miningTestDeployment(), tx = write(d, 'manager', 'createToken', launchArgs(d))
    expect(validMiningProductCall({ ...tx, data: `${tx.data}00` }, d, true, now)).toBe(false)
    // Replacing the first tuple offset points into the static head instead of the encoded struct.
    const data = `${tx.data.slice(0, 10)}${'0'.repeat(64)}${tx.data.slice(74)}` as Hex
    expect(validMiningProductCall({ ...tx, data }, d, true, now)).toBe(false)
  })
  it('preserves existing zero-value harvest and rejects direct market purchases', () => {
    const d = miningTestDeployment()
    expect(validMiningProductCall(write(d, 'farm', 'harvest', []), d, true, now)).toBe(true)
    const tx = { from: MINING_TEST_ACCOUNT, to: d.contracts.circuitMarket.address, value: '0x1',
      data: encodeFunctionData({ abi: parseAbi(MINING_PRODUCT_WRITE_ABI.circuitMarket), functionName: 'buy', args: [1n, 1n] }) }
    expect(validMiningProductCall(tx, d, true, now)).toBe(false)
  })
})

describe('signed workflow read ABI', () => {
  it('exposes only actual bound contract getter signatures on their correct roles', () => {
    const d = miningTestDeployment()
    const reads: [keyof typeof MINING_PRODUCT_READ_ABI, string, readonly unknown[]][] = [
      ['miningFactory', 'vaultOf', [d.projects[0].token.address]], ['miningFactory', 'QUOTE_SIGNER', []],
      ['farm', 'MAX_MINERS', []], ['farm', 'admissibleMiner', [1n]], ['farm', 'usedNonce', [0n]],
      ['farm', 'purchaseDigest', [purchase]], ['farm', 'QUOTE_SIGNER', []],
      ['projectVault', 'usedConversionNonce', [0n]], ['projectVault', 'conversionDigest', [conversion]],
      ['projectVault', 'QUOTE_SIGNER', []], ['projectVault', 'ROUTER', []],
      ['router', 'getAmountsIn', [1n, [d.contracts.fab.address, d.contracts.wrappedNative.address]]],
      ['pair', 'factory', []], ['v2Factory', 'getPair', [d.projects[0].token.address, d.contracts.fab.address]],
    ]
    for (const [role, name, args] of reads) {
      const abi = miningAbi(role, 'read'), data = encodeFunctionData({ abi, functionName: name, args })
      const to = role === 'projectVault' ? d.projects[0].vault.address : role === 'pair' ? d.projects[0].pair!.address
        : d.contracts[role as 'farm' | 'router' | 'miningFactory' | 'v2Factory'].address
      expect(decodeFunctionData({ abi, data }).functionName).toBe(name)
      expect(validMiningProductCall({ to, data }, d, false, now)).toBe(true)
      expect(validMiningProductCall({ to, data: `${data}00` }, d, false, now)).toBe(false)
    }
    const wrongRole = encodeFunctionData({ abi: miningAbi('farm', 'read'), functionName: 'purchaseDigest', args: [purchase] })
    expect(validMiningProductCall({ to: d.contracts.fragmentVault.address, data: wrongRole }, d, false, now)).toBe(false)
  })
})
