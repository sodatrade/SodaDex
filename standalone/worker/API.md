# SodaDEX read API, schemaVersion 1

All routes are GET, same-origin. Error: `{error:string}` with HTTP 400/502. BigInt raw values use decimal strings. Protocol is `v3` or `v4`. No credentials/signing/broadcasting/storage service.

`GET /api/dex/pools[?fromBlock=73361037&toBlock=73363036]`

Returns current known pools immediately; optional bounded discovery interval finds new factory/manager pools. Default includes the two manifest pools and a discovery scan over the latest 2000 blocks. State is pinned to `asOf.number`.

```ts
interface Block { number:number; hash:string; timestamp:number }
interface Coverage { fromBlock:number; toBlock:number; complete:boolean; nextFromBlock:number|null }
interface Pool {
  protocol:'v3'|'v4'; id:string; address:string|null; token0:string; token1:string;
  fee:number; tickSpacing:number; hooks:string; createdBlock:number|null;
  source:'manifest'|'chain'; sqrtPriceX96:string|null; tick:number|null;
  liquidity:string|null; stateError:string|null;
}
interface PoolsResponse { schemaVersion:1; chainId:196; asOf:Block; coverage:Coverage; pools:Pool[] }
```

`GET /api/dex/events[?fromBlock=N&toBlock=N&owner=0x...&cursor=...&pool=...]`

Default begins at first SodaDEX deployment block 73361037 and advances at most 2000 blocks/request. `toBlock` is the desired overall terminal block, bounded by the current chain head (may exceed this page). Response contains all types of known deployed pool/factory/NFT manager events, sorted by block/log index. Up to 20 log candidates are processed per cursor page. Pass `nextCursor` verbatim in `cursor` with the same owner/fromBlock/toBlock query. When cursor is null, move fromBlock to coverage.nextFromBlock. Null nextFromBlock means requested range exhausted. Empty events means no matching events **in this coverage only**. Owner filter includes transaction sender and NFT Transfer from/to, not all activity of wallets holding tokens. Global history includes both NFT managers, Factory, all V4 pools, and the manifest V3 pool; pass pool=V3Address for a newly created V3 pool's swap history (registry verified). For V4 pool=ID, supply the same key metadata as market for nonmanifest pools. Pool-scoped history contains that pool's events, not global NFT history.

```ts
interface DexEvent {
  id:string; protocol:'v3'|'v4'; address:string; event:string; blockNumber:number;
  blockHash:string; transactionHash:string; logIndex:number;
  args:Record<string,string|number|boolean>; transactionFrom:string|null;
}
interface EventsResponse {
  schemaVersion:1;chainId:196;asOf:Block;coverage:Coverage;
  events:DexEvent[]; nextCursor:string|null;
}
```

Identity is `blockHash:logIndex`: dedupe by id, and replace records at a block height when its canonical block hash changes. `asOf.hash` is the current canonical observation, not a finality guarantee. This stateless service has no permanent index or claimed complete lifetime history.

`GET /api/dex/market?pool=V3AddressOrV4PoolId[&fromBlock=N&toBlock=N]`

Default metric range is latest 2000 blocks. Accepts the manifest pools and a discovered pool when metadata (`protocol,token0,token1,fee,tickSpacing,hooks`) supplied by `/pools`; this generic metadata extension is not required for the first two pools. Values describe the coverage range, **not 24h unless timestamps prove that interval**.

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

Volume is sum of absolute token deltas from swaps, each currency independently. V3 fee is an **estimate** `input*poolFee/1e6`, because the Swap event does not expose exact rounding/protocol fee splits. V4 event `fee` similarly yields an estimate and cannot be labeled collected LP income. USD TVL/APR remain null without independent price/time-series input. V3 reserves are actual pool token balances, not a computed position value; singleton V4 reserves remain null (PoolManager token balance cannot be allocated to a pool).

RPC additions: strict canonical ERC20 metadata/read selectors at arbitrary token addresses; own NPM/factory/StateView reads; V3 pool-specific selectors require its factory() equals own Factory before forwarding. eth_getLogs is limited to deployed addresses, supported event topics, explicit >=deployment blocks and <=2000 block intervals. LP simulation is allowed only to active NPMs with exact canonical encoding, wallet recipients/refunds and no hook data. Router swaps and positive Permit2 Router approvals stay paused.
