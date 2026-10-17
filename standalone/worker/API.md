# SodaDEX read API, schemaVersion 1

All routes are GET, same-origin. BigInt raw values are decimal strings. No signing, broadcasting, database, paid resources or scheduled jobs. RPC source remains the configured X Layer 196 node.

## Cursor and reorganization contract

`/pools` and `/events` return `nextCursor:string|null`. Pass an opaque cursor verbatim as `cursor` with the **same original query parameters**; do not also advance fromBlock while nextCursor exists. Cursors are immutable server-side scan checkpoints in the existing Cloudflare Cache API, expiring after one hour and subject to cache eviction/region changes. No caller-supplied pool list is trusted as complete.

Each scan binds a canonical anchor block number/hash. Before and after continuation, the Worker checks that hash again. On HTTP **409**, discard every accumulated page of the affected scan and restart its original request without cursor:

```ts
{error:string, code:'CHAIN_REORGANIZED'|'CURSOR_EXPIRED', restartFromBlock:number}
```

A changed anchor never applies an old log offset to replacement events. A removed anchor is also a reorganization. Cache loss is recoverable, not empty history. Other malformed queries return 400; source/decoding failures return 502, never synthetic zero metrics.

```ts
interface Block { number:number; hash:string; timestamp:number }
interface Coverage { fromBlock:number; toBlock:number; complete:boolean; nextFromBlock:number|null }
interface Pool {
  protocol:'v3'|'v4'; id:string; address:string|null; token0:string; token1:string;
  fee:number; tickSpacing:number; hooks:string; createdBlock:number|null;
  source:'manifest'|'chain'; sqrtPriceX96:string|null; tick:number|null;
  liquidity:string|null; stateError:string|null;
}
```

Coverage describes this **block interval**, not lifetime history. `complete:true` requires a single completed scan from deployment through its observation head. To assess accumulated scans, retain their original discovery start/target and contiguous coverage rather than treating an empty page as complete.

## Pools

`GET /api/dex/pools[?fromBlock=N&toBlock=N&cursor=...]`

Default discovery begins at first deployment block **73361037**, not the last 2000 blocks. It scans 2000 blocks per page through the first response's fixed observation head. Each page includes the two manifest pools plus factory/manager pool creation events in that interval. **Accumulate and deduplicate pools by protocol/id across pages** so older self-created pools remain visible. Continue until nextCursor is null. Pool states use the same `asOf.number` across the scan.

```ts
interface PoolsResponse {
  schemaVersion:1; chainId:196; asOf:Block; coverage:Coverage; pools:Pool[];
  nextCursor:string|null; discoveryStartBlock:number; discoveryTargetBlock:number;
  discoveryComplete:boolean; // Entire requested discovery range exhausted across pages.
}
```

There are at most eight snapshots per response to bound RPC subrequests; additional discovered records remain in `pools` with a stateError telling the client to fetch market detail. Failed discovery is an error, not a silently incomplete pool list.

## Events

`GET /api/dex/events[?fromBlock=N&toBlock=N&owner=0x...&pool=...&cursor=...]`

Default event interval starts at deployment, at most 2000 blocks per range. Global history first discovers **all V3 pools created by the own Factory from deployment through this range's endpoint**, including pools created before the queried interval. It scans those pool addresses, Factory, both NFT managers and own V4 PoolManager. V4 pool events already share the PoolManager address. No fixed-manifest V3 filter is used for global history.

Discovery or address batching can span HTTP requests to respect Worker subrequest limits. While preparing, the response is `phase:'discovery'`, `events:[]`, `nextCursor:non-null`, and `coverage.complete:false`. This state means **continue scanning**, not no history. Up to eight factory log requests and eight address-batch log requests run per HTTP request. Once prepared, events are globally ordered and paged at 20 candidate logs. Cursor snapshots retain the discovered registry and ordered log buffer; each continuation checks the canonical anchor before reusing them.

```ts
interface DexEvent {
  id:string; protocol:'v3'|'v4'; address:string; event:string; blockNumber:number;
  blockHash:string; transactionHash:string; logIndex:number;
  args:Record<string,string|number|boolean>; transactionFrom:string|null;
}
interface EventsResponse {
  schemaVersion:1;chainId:196;asOf:Block;coverage:Coverage;events:DexEvent[];
  phase:'discovery'|'events';nextCursor:string|null;
  discovery:{fromBlock:number;throughBlock:number;targetBlock:number;poolCount:number;scannedAddresses:number;totalAddresses:number};
}
```

When nextCursor becomes null, move fromBlock to coverage.nextFromBlock to scan the next block interval. Null nextFromBlock means the requested overall terminal block is reached. Owner filtering includes transaction sender and NFT Transfer from/to; transaction blockHash must match the event. Identity is `blockHash:logIndex`; dedupe by id, and replace a range on 409. No permanent/finalized history is claimed.

`pool=V3Address` scans only that registered pool's events; `pool=V4Id` requires the same metadata rules as market for nonmanifest keys. Pool-scoped history excludes global NFT manager events. Dense ranges exceeding the bounded log buffer return an error requiring a narrower from/to interval.

## Market

`GET /api/dex/market?pool=V3AddressOrV4PoolId[&fromBlock=N&toBlock=N]`

Default metric range is the latest 2000 blocks. Values describe the coverage range, **not 24h**. For a nonmanifest V3 address, the Worker verifies factory(), token addresses/fee and the own Factory registry. For nonmanifest V4 IDs, supply `token0,token1,fee,tickSpacing,hooks=0`; their canonical pool-key hash must match the ID.

```ts
interface Token { address:string; symbol:string|null; name:string|null; decimals:number|null }
interface MarketResponse {
  schemaVersion:1;chainId:196;asOf:Block;coverage:Coverage;pool:Pool;
  token0:Token;token1:Token;priceToken1PerToken0:string|null;
  priceHistory:{blockNumber:number;logIndex:number;sqrtPriceX96:string}[];
  volume:{token0Raw:string;token1Raw:string};
  fees:{token0Raw:string|null;token1Raw:string|null;reason:string|null};
  reserves:{token0Raw:string|null;token1Raw:string|null;reason:string|null};
  tvlUsd:null;apr:null;unavailableReasons:string[];
}
```

Volume sums absolute Swap token deltas separately per currency. Fee values are **estimates** of input*event/pool fee, not exact rounding, protocol splits, claimable income or collected fees. priceHistory contains the actually scanned Swap sqrt prices, with block/log positions; an empty array is not a fabricated flat chart. V3 reserves are actual pool token balances. V4 singleton reserves are null because a shared PoolManager balance cannot be attributed to one pool. USD TVL/APR are null without independent USD prices/time-series evidence.

## RPC additions and transaction boundary

Canonical ERC20 metadata/balance/allowance reads work at arbitrary addresses. Own Factory/NPM/StateView reads are allowed. Dynamic V3 pool-specific reads require an actual own Factory registry match, not merely a claimed factory() getter. eth_getLogs remains bounded to deployed addresses and supported topics with explicit >=deployment block ranges of at most 2000.

Read-only own V3 Quoter requests may use custom nonzero distinct token addresses and fees; the Worker checks own Factory.getPool is nonzero before forwarding. V4 Quoter accepts canonical sorted hookless keys with empty hookData and only forwards after own StateView reports nonzero initialized sqrtPriceX96. Registration/initialization is checked at the exact requested block tag for manifest and custom pools alike. Foreign adapters, unknown hooks, noncanonical/trailing bytes and quote gas simulations are blocked.

UniversalRouter simulations support **single-hop, exact-input trades in self-created pools** through the active Router only. V3 paths contain exactly 43 bytes (`tokenIn + uint24 fee + tokenOut`); the own Factory must register that exact pair/fee and the returned pool must have nonzero initialized slot0 sqrtPriceX96 at the requested block. Canonical command sequences are `0x00` for ERC20/ERC20, `0x0b000c04` for native input and `0x000c04` for native output. Native conversion must use official WOKB, direct proceeds and terminal unwrap/refund recipients must match the caller, and the native value must exactly match native input. V4 uses commands `0x1004`, actions `0x060c0f`, a sorted initialized hookless key in the own PoolManager, exact input settlement, matching minimum output take, empty hook data and terminal caller refund. No multihop, arbitrary commands/adapters or alternative recipient is admitted. Registration checks run before forwarding the Router `eth_call` or `eth_estimateGas`; calls honor their exact requested block tag and gas estimation uses `latest`.

The shared `publicSwapsEnabled` policy still controls Router execution and positive Permit2 Router approval simulations. Finite Permit2 Router approval may name any nonzero ERC20 token; its spender remains the active Router, amount is below the uint160 unlimited sentinel and expiration is positive and below the uint48 unlimited sentinel. Resets remain available while swaps are paused. Official WOKB alone supports canonical `deposit()` with positive matching native value and `withdraw(uint256)` with positive finite amount and zero native value. Wrapping is independent of the swap pause and does not introduce token transfers or other write selectors. The Worker only simulates; the browser wallet confirms and broadcasts.

LP simulation remains limited to active NPMs, canonical business operations, finite approvals, wallet recipients/refunds and current NFT ownership/currency bindings. No NFT transfers/operator approvals are introduced.

## Timestamp charts

`GET /api/dex/chart?pool=V3AddressOrV4PoolId&interval=1m|5m|1h|4h|1d[&fromBlock=N&toBlock=N&cursor=...]`

The pool/key parameters follow market (`protocol` may be supplied and must match). Custom V3 pools use the same own-Factory registry verification. Custom V4 keys use their canonical hash and an initialized own StateView snapshot. Existing `/market` fields and behavior are unchanged.

`interval` is required. Default range is **deployment block 73361037 through the first response's asOf block**, never an assumed 24-hour window. A supplied toBlock is clamped to that observation head. The pool/token metadata and current price are read at this fixed asOf block. Unix timestamps are seconds and candle buckets align to UTC.

```ts
interface ChartTrade {
  id:string;blockNumber:number;blockHash:string;transactionHash:string;logIndex:number;timestamp:number;
  amount0Raw:string;amount1Raw:string; // Signed deltas exactly as emitted by the protocol.
  volume0Raw:string;volume1Raw:string; // Absolute values, independently per currency.
  sqrtPriceX96:string;priceToken1PerToken0:string|null;sender:string;recipient:string|null;
}
interface ChartCandle {
  time:number;bucketEndTime:number;
  open:string|null;high:string|null;low:string|null;close:string|null;
  sqrtPriceOpenX96:string;sqrtPriceHighX96:string;sqrtPriceLowX96:string;sqrtPriceCloseX96:string;
  volume0Raw:string;volume1Raw:string;tradeCount:number;firstBlock:number;lastBlock:number;
}
interface ChartResponse {
  schemaVersion:1;chainId:196;asOf:Block;coverage:Coverage;pool:Pool;token0:Token;token1:Token;
  interval:'1m'|'5m'|'1h'|'4h'|'1d';query:{fromBlock:number;toBlock:number};
  priceToken1PerToken0:string|null;priceUnavailableReason:string|null;
  candles:ChartCandle[];trades:ChartTrade[];queryComplete:boolean;nextCursor:string|null;
}
```

Each successful page returns **cumulative candles and trades for that scan**. Replace the arrays with the latest response rather than adding volumes/counts again. Both the first and subsequent pages may be incomplete. `query` preserves the full requested range; `coverage.fromBlock..toBlock` is the verified contiguous prefix processed so far, and nextFromBlock points to the next unprocessed block. Only queryComplete means the entire requested range has been processed. It does not imply finality or that the current UTC candle has ended.

One HTTP request scans at most one 2000-block log range and reads headers for at most **eight distinct Swap blocks**. If there are more blocks containing trades, its pending log page is retained in the opaque cursor and subsequent requests continue timestamp validation without re-reading that log page. Each Swap block number/hash must match its fetched header; timestamp must be safe, nonnegative, not after asOf, and nondecreasing in canonical block/log order. The fixed range-end anchor is checked before continuation and after processing. The existing 409 restart contract applies to reorganization, mismatched hashes, parameter replay and expired/evicted cache state. RPC/decoding failures are errors rather than empty chart data.

Only actual Swap events produce candles; untraded buckets stay absent. V3 positive amounts are pool input while V4 BalanceDelta uses negative input; consumers must interpret direction using protocol/token orientation. V4 Swap does not emit a recipient, so recipient is null. Sender is the event sender (often a router), not an inferred wallet.

Price scaling and OHLC comparisons use BigInt, with decimal output rounded down after 320 fractional places. Missing token decimals produce null human price fields and priceUnavailableReason, while exact raw sqrt values, volumes, trade counts and verified timestamps remain available. Symbols/names may independently be null. Duplicate log identities are counted once; contradictory duplicates are rejected.

A scan is limited to **5000 cumulative trades** to bound ephemeral Worker/cache memory. Exceeding it returns HTTP 400 requesting a narrower block range; no truncated result is presented as complete. The endpoint uses the existing expiring Cache API, not a durable market index, database, scheduler or new cloud resource. The exact exported response types are in `src/dex-chart-types.ts`.
