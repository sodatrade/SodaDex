import { describe, expect, it } from 'vitest'
import { readImportedTokenAddresses, rememberToken, removeToken } from '../src/domain/tokenCatalog'
const address = '0x3333333333333333333333333333333333333333'
describe('shared imported token catalog', () => {
  it('persists only unique addresses and supports removal', () => {
    rememberToken(address); rememberToken(address)
    expect(readImportedTokenAddresses()).toEqual([address])
    const content = localStorage.getItem('sodadex.imported-tokens.196.v1')!
    expect(JSON.parse(content)).toEqual([address]); expect(content).not.toContain('decimals')
    removeToken(address); expect(readImportedTokenAddresses()).toEqual([])
  })
  it('ignores tampered or malformed stored metadata', () => {
    localStorage.setItem('sodadex.imported-tokens.196.v1', JSON.stringify([address, { address, decimals: 1 }, 'bad']))
    expect(readImportedTokenAddresses()).toEqual([address])
    localStorage.setItem('sodadex.imported-tokens.196.v1', 'broken')
    expect(readImportedTokenAddresses()).toEqual([])
  })
})
