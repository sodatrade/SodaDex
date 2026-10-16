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

Read-only own V3 Quoter requests may use custom nonzero distinct token addresses and fees; the Worker checks own Factory.getPool is nonzero before forwarding. V4 Quoter accepts canonical sorted hookless keys with empty hookData and only forwards after own StateView reports nonzero initialized sqrtPriceX96. Registration/initialization is checked at the exact requested block tag for manifest and custom pools alike. Foreign adapters, unknown hooks, noncanonical/trailing bytes and quote gas simulations are blocked. **This does not open UniversalRouter transaction execution or positive Permit2 Router approvals.**

LP simulation remains limited to active NPMs, canonical business operations, finite approvals, wallet recipients/refunds and current NFT ownership/currency bindings. No NFT transfers/operator approvals are introduced.
