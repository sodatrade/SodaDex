import dependencies from '../deployments/xlayer-1952/dependencies.json'

type Address = `0x${string}`
export type MiningBaseRole = 'fab' | 'mining' | 'circuits' | 'circuitMarket' | 'lens'

function verifiedAddress(role: MiningBaseRole): Address {
  const entry = dependencies.dependencies.filter((item) => item.role === role)
  if (dependencies.chainId !== 1952 || entry.length !== 1 || !entry[0].sourceVerified ||
      !/^0x[0-9a-fA-F]{40}$/.test(entry[0].address ?? '') ||
      !/^[0-9a-f]{64}$/.test(entry[0].expectedRuntimeSha256 ?? '')) throw new Error('Unverified 1952 base dependency')
  return entry[0].address as Address
}

/** Base contracts only. A verified FABX deployment does not enable either product. */
export const MINING_BASE = Object.freeze({
  chainId: 1952 as const,
  fab: verifiedAddress('fab'), mining: verifiedAddress('mining'), circuits: verifiedAddress('circuits'),
  circuitMarket: verifiedAddress('circuitMarket'), lens: verifiedAddress('lens'),
})

export const MINING_READ_SIGNATURES = {
  fab: ['function balanceOf(address account) view returns (uint256)', 'function totalSupply() view returns (uint256)',
    'function decimals() view returns (uint8)', 'function symbol() view returns (string)'],
  mining: ['function totalMined() view returns (uint256)', 'function minerCount() view returns (uint256)',
    'function verifMinerCount() view returns (uint256)', 'function paused() view returns (bool)'],
  circuits: ['function balanceOf(address account) view returns (uint256)', 'function ownerOf(uint256 id) view returns (address)'],
  circuitMarket: ['function feeBps() view returns (uint16)'],
  lens: ['function dailyEmission() view returns (uint256)', 'function currentEra() view returns (uint256)'],
} as const
