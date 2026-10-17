# Official X Layer pool references

These same-origin GET endpoints expose **read-only** Uniswap pool references on chain 196. They never return calldata, transaction targets, approval spenders or signatures. The existing `/api/rpc` Router/Permit2 guard continues to admit SodaDEX adapters only. Ordinary wallet Send remains an independent user-confirmed operation.

Contract addresses come from the official [deployment feed](https://developers.uniswap.org/deployments.json). [xlayer-reference.json](../../deployments/xlayer-reference.json) records the source content hash, source commit, actual chain block, deployed code hashes and verified Quoter/StateView bindings. All live reads use the configured `https://rpc.ignix.bot/rpc/196`; callers cannot replace the upstream or contract adapters.

## Token directory

`GET /api/reference/tokens`

Returns `ReferenceTokensResponse` from [reference-types.ts](src/reference-types.ts):

```ts
{schemaVersion:1,chainId:196,source:'uniswap',readOnly:true,
 tokens:[{chainId:196,address,symbol,name,decimals,logoURI,
          metadataSource:'okx-tokenlist',metadataError:null}],
 tokenList:{source,timestamp,contentSha256}}
```

This is a checked-in snapshot of ten tokens from [OKX's X Layer token list](https://raw.githubusercontent.com/okx/xlayer-tokenlist/main/xlayer.tokenlist.json), not the complete chain token universe or a ranking. Directory metadata is explicitly distinguished from on-chain metadata. Consumers must validate an imported currency on chain before transaction construction. Logo URLs retain the official list's provenance; this API does not fetch arbitrary media. No RPC request is needed to load this directory. Native OKB remains the frontend's built-in native asset rather than an ERC20 entry.

## Selected-pair discovery

`GET /api/reference/pools?token0=0x...&token1=0x...`

The response includes `asOf:{number,hash,timestamp}`, `requestedPair`, `pools`, `errors` and `discovery:{kind:'pair-candidates',complete:false,v3Fees,v4Keys}`. Exact response types are exported in `reference-types.ts`.

The bounded candidate set is one V2 pair, V3 fees `100,500,3000,10000`, and hookless V4 `(fee,tickSpacing)` keys `(100,1),(500,10),(3000,60),(10000,200)`. These V4 combinations are search candidates, not an exhaustive or required configuration. Other fees, spacings and hooks may exist. This is **not** a full-chain pool index, a popularity table or a complete liquidity search. There is no log scan, persistent database, credentialed API, scheduler or paid infrastructure.

V2/V3 map a requested native-zero address to official WOKB. `requestedPair` preserves the request; each returned pool's sorted `token0`/`token1` describes its actual assets. V4 keeps native OKB distinct from WOKB. Pool token names/symbols/decimals are read from chain at the same pinned block, with nullable fields and `metadataError` on failure; known logo metadata comes from the static OKX list. Decimals are never silently replaced with a guessed value.

V2 resolves the official Factory's `getPair`, then reads reserves and LP total supply. V3 resolves the official Factory's exact pair/fee, then reads initialized slot0, active liquidity, tick spacing and actual token balances. V4 computes the exact sorted hookless pool ID and reads official StateView slot0/liquidity. Its singleton reserves remain null. `liquidity` is a protocol-specific raw value: V2 LP total supply and V3/V4 active liquidity are not interchangeable units. `priceToken1PerToken0` is a pool spot ratio using actual token decimals; it is not an independent market or USD reference price.

Absent/uninitialized candidates are omitted. Failed candidate reads appear in `errors`; missing token metadata or balances remains null rather than fabricated zero. The fully populated candidate set stays below 50 RPC subrequests (43 in the current implementation); all contract reads share the one returned block number. The head and chain ID are checked per request. No USD TVL, APR, 24-hour volume or invented time series is returned.

## Reference quote

```text
GET /api/reference/quote?protocol=v2&tokenIn=0x...&tokenOut=0x...&amountInRaw=100
GET /api/reference/quote?protocol=v3&tokenIn=0x...&tokenOut=0x...&amountInRaw=100&fee=500
GET /api/reference/quote?protocol=v4&tokenIn=0x...&tokenOut=0x...&amountInRaw=100&fee=500&tickSpacing=10
```

Returns `ReferenceQuoteResponse`, including source/readOnly/asOf, protocol, poolId, requested tokenIn/tokenOut, actual poolTokenIn/poolTokenOut, fee/tickSpacing, raw input/output and nullable `gasEstimate`. Quotes are exact-input single-hop references only. Custom valid V3 fees and hookless V4 fee/spacing keys can be requested directly even when outside the discovery candidates. The exact pool must be registered/initialized before any Quoter is called.

V2 uses the canonical [UniswapV2Library.getAmountOut](https://github.com/Uniswap/v2-periphery/blob/master/contracts/libraries/UniswapV2Library.sol) formula with 997/1000 input adjustment and integer flooring. It does not model fee-on-transfer tokens. V3/V4 call only the official Quoter through `eth_call` at the pinned block. Their gas estimate is the Quoter's measured operation gas, not a prepared transaction's total gas. No simulation writes state. Native wrapping is represented explicitly by the pool currency aliases; this endpoint never builds a wrapping transaction.

Unknown/duplicate query parameters, mismatched protocol parameters, malformed addresses and out-of-type amounts return 400. Missing pools and nonpositive quotes return 400. Chain/Quoter availability failures return 502 with no fabricated quote. Reverts, empty-liquidity pools and transient source failures can make an individual quote unavailable. Only GET is supported; foreign browser origins are rejected. The user cannot supply hooks, arbitrary calldata, RPC methods, routers, recipients or approval data.
