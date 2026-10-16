import type { Block } from './dex-data'
export interface ReferenceToken {
  chainId: 196; address: string; symbol: string | null; name: string | null; decimals: number | null;
  logoURI: string | null; metadataSource: 'chain' | 'okx-tokenlist' | 'native-chain'; metadataError: string | null
}
export interface ReferencePool {
  protocol: 'v2' | 'v3' | 'v4'; source: 'uniswap'; readOnly: true; id: string; address: string | null;
  token0: ReferenceToken; token1: ReferenceToken; fee: number; tickSpacing: number | null; hooks: string | null;
  sqrtPriceX96: string | null; tick: number | null; liquidity: string | null;
  reserves: { token0Raw: string | null; token1Raw: string | null };
  priceToken1PerToken0: string | null; stateError: string | null
}
export interface ReferenceTokensResponse {
  schemaVersion: 1; chainId: 196; source: 'uniswap'; readOnly: true; tokens: ReferenceToken[];
  tokenList: { source: string; timestamp: string; contentSha256: string }
}
export interface ReferencePoolsResponse {
  schemaVersion: 1; chainId: 196; source: 'uniswap'; readOnly: true; asOf: Block;
  requestedPair: { token0: string; token1: string }; pools: ReferencePool[];
  discovery: { kind: 'pair-candidates'; complete: false; v3Fees: readonly number[]; v4Keys: readonly { fee: number; tickSpacing: number }[] };
  errors: { protocol: 'v2' | 'v3' | 'v4'; fee: number | null; tickSpacing: number | null; message: string }[]
}
export interface ReferenceQuoteResponse {
  schemaVersion: 1; chainId: 196; source: 'uniswap'; readOnly: true; asOf: Block;
  protocol: 'v2' | 'v3' | 'v4'; poolId: string; tokenIn: string; tokenOut: string;
  poolTokenIn: string; poolTokenOut: string;
  fee: number; tickSpacing: number | null;
  amountInRaw: string; amountOutRaw: string; gasEstimate: string | null
}
