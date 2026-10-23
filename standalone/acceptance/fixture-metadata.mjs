import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const bytes = await readFile(new URL('./fixtures/usdt0-metadata.json', import.meta.url))
const sha256 = value => createHash('sha256').update(value).digest('hex')
if (sha256(bytes) !== '9cca414ab40f4c10a426feb3abddae4cabeba824eb337aa748257f148e82ca04')
  throw Error('Reviewed USDt0 metadata fixture changed')
const metadata = JSON.parse(bytes.toString('utf8'))
const codeHash = code => {
  if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(code)) throw Error('Token runtime missing')
  return sha256(Buffer.from(code.slice(2), 'hex'))
}
const word = value => '0x' + BigInt(value).toString(16).padStart(64, '0')

/** Repair only omitted metadata from the reviewed offline dump, never a live RPC.
 * The caller owns the disposable Anvil process. No remote URL or private key is accepted.
 */
export async function installFixtureMetadata(request) {
  if (await request('eth_chainId') !== '0xc4' || !String(await request('web3_clientVersion')).toLowerCase().includes('anvil'))
    throw Error('Owned chain-196 Anvil metadata setup required')
  const [proxyCode, implementationCode, implementation] = await Promise.all([
    request('eth_getCode', [metadata.address, 'latest']),
    request('eth_getCode', [metadata.implementation, 'latest']),
    request('eth_getStorageAt', [metadata.address, metadata.implementationSlot, 'latest']),
  ])
  if (codeHash(proxyCode) !== metadata.runtimeSha256 || codeHash(implementationCode) !== metadata.implementationRuntimeSha256 ||
    word(implementation) !== word(metadata.implementation)) throw Error('Reviewed USDt0 proxy/runtime identity mismatch')
  const missing = []
  // Validate all slots before the first write. A nonzero conflicting value is
  // a different fixture, not permission to replace an asset's metadata.
  for (const [slot, expected] of Object.entries(metadata.storage)) {
    const actual = word(await request('eth_getStorageAt', [metadata.address, slot, 'latest']))
    if (actual === expected) continue
    if (BigInt(actual) !== 0n || BigInt(expected) === 0n) throw Error('USDt0 metadata conflicts with the reviewed fixture')
    missing.push([slot, expected])
  }
  for (const [slot, value] of missing) await request('anvil_setStorageAt', [metadata.address, word(slot), value])
  for (const [selector, expected] of Object.entries(metadata.calls)) {
    const actual = await request('eth_call', [{ to: metadata.address, data: selector }, 'latest'])
    if (typeof actual !== 'string' || actual.toLowerCase() !== expected) throw Error('USDt0 metadata call verification failed')
  }
  return { address: metadata.address, sourceBlock: metadata.source.blockNumber, changedSlots: missing.map(([slot]) => slot), ...metadata.expected }
}
