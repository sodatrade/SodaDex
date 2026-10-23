export type NetworkProfileId = '196-test' | '1952-mining-test' | '196-mining-test'

export interface NetworkProfile {
  readonly id: NetworkProfileId
  readonly chainId: 196 | 1952
  readonly chainHex: '0xc4' | '0x7a0'
  readonly chainName: string
  readonly rpcUrl: string
  readonly explorerUrl: string
  readonly nativeCurrency: { readonly name: 'OKB'; readonly symbol: 'OKB'; readonly decimals: 18 }
  readonly dexEnabled: boolean
  readonly ordersEnabled: boolean
  readonly referenceEnabled: boolean
}

const nativeCurrency = Object.freeze({ name: 'OKB', symbol: 'OKB', decimals: 18 } as const)
const profiles: Readonly<Record<NetworkProfileId, NetworkProfile>> = Object.freeze({
  '196-test': Object.freeze({
    id: '196-test', chainId: 196, chainHex: '0xc4', chainName: 'X Layer',
    rpcUrl: 'https://rpc.ignix.bot/rpc/196', explorerUrl: 'https://www.oklink.com/xlayer',
    nativeCurrency, dexEnabled: true, ordersEnabled: true, referenceEnabled: true,
  }),
  '196-mining-test': Object.freeze({
    id: '196-mining-test', chainId: 196, chainHex: '0xc4', chainName: 'X Layer · Mining TEST',
    rpcUrl: 'https://rpc.ignix.bot/rpc/196', explorerUrl: 'https://www.oklink.com/xlayer',
    nativeCurrency, dexEnabled: false, ordersEnabled: false, referenceEnabled: false,
  }),
  '1952-mining-test': Object.freeze({
    id: '1952-mining-test', chainId: 1952, chainHex: '0x7a0', chainName: 'X Layer Testnet',
    rpcUrl: 'https://testrpc.xlayer.tech/terigon', explorerUrl: 'https://www.okx.com/web3/explorer/xlayer-test',
    nativeCurrency, dexEnabled: false, ordersEnabled: false, referenceEnabled: false,
  }),
})

/** Only explicit deployment configuration selects a profile; unknown values never fall back. */
export function networkProfile(value: unknown = '196-test'): NetworkProfile {
  if (value !== '196-test' && value !== '1952-mining-test' && value !== '196-mining-test') throw new Error('Unknown SodaDEX network profile')
  return profiles[value]
}

export function publicNetworkProfile(profile: NetworkProfile): Omit<NetworkProfile, 'rpcUrl'> {
  const { rpcUrl: _rpcUrl, ...publicProfile } = profile
  return publicProfile
}
