import { ERC20_READ, same, ZERO } from './contracts'
import { BadRequest, hex, type Block } from './dex-data'
import { tokenList } from './reference-config'
import type { ReferenceToken, ReferenceTokensResponse } from './reference-types'
import { call } from './upstream'
export function referenceAddress(value: string | null): string {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new BadRequest('Valid token address required')
  return value.toLowerCase()
}
export function referenceTokenList(): ReferenceTokensResponse {
  return { schemaVersion: 1, chainId: 196, source: 'uniswap', readOnly: true,
    tokens: tokenList.tokens.map((token) => ({ ...token, chainId: 196, metadataSource: 'okx-tokenlist', metadataError: null })),
    tokenList: { source: tokenList.source, timestamp: tokenList.timestamp, contentSha256: tokenList.contentSha256 } }
}
export async function referenceToken(address: string, block: Block, upstreamFetch: typeof fetch): Promise<ReferenceToken> {
  if (same(address, ZERO)) return { chainId: 196, address, symbol: 'OKB', name: 'OKB', decimals: 18, logoURI: null, metadataSource: 'native-chain', metadataError: null }
  const values = await Promise.allSettled(['symbol', 'name', 'decimals'].map((name) => call(ERC20_READ, address, name, [], hex(block.number), upstreamFetch)))
  const read = (index: number): unknown => values[index].status === 'fulfilled' ? values[index].value : null
  const symbol = read(0), name = read(1), decimals = read(2)
  const known = tokenList.tokens.find((token) => same(token.address, address))
  return { chainId: 196, address, symbol: typeof symbol === 'string' ? symbol.slice(0, 80) : null, name: typeof name === 'string' ? name.slice(0, 160) : null,
    decimals: typeof decimals === 'number' ? decimals : null, logoURI: known?.logoURI ?? null, metadataSource: 'chain', metadataError: values.some((value) => value.status === 'rejected') ? 'Token metadata partially unavailable' : null }
}
