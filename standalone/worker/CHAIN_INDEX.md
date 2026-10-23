# Test chain index

The `SodaChainIndex` SQLite Durable Object is an independent **read model**. It has no signer, keeper ledger, transaction submission route, or private-key binding. Transaction preparation and confirmation continue to read and simulate against the live chain.

## Routes and data

- `/api/index/status|pools|events`: fixed 196 SodaDEX test deployment.
- `/mining/api/index/status|pools|events`: fixed 1952 mining test deployment.
- Existing `/api/dex/pools|events` use the index when its binding is deployed. Existing chart/market history readers reuse indexed canonical logs for covered intervals, falling back to their existing validated chain reader for missing coverage.
- Every page has at most 10 rows. `limit` accepts 1–10. Events accept `owner`, `pool`, `event`, `fromBlock`, and `toBlock`; `pool` is an emitting address or v4 pool ID. A cursor binds the route, filters, block snapshot and index generation and expires after one hour.
- A page's `asOf` is the indexed checkpoint. `index.head` is the most recently observed chain head; `index.syncing` and `index.lastError` distinguish unfinished/failed history from a complete empty result. New index routes allow `asOf: null` before the first checkpoint. Legacy DEX routes retain a non-null `asOf` using one head read during cold start.
- Known manifest pools are returned immediately. Metadata alone does not assert current reserves; trading and liquidity consumers verify their state live.

## Persistence and recovery

Each actor is named by chain and deployment identity. The 196 identity also hashes root contract addresses and the deployment start block. The 1952 identity uses the receipt-pinned product version. Mining event ABIs come from the deployed IGNIX/FABX sources; ERC20 and NFT `Transfer` logs are decoded by emitting contract role.

Raw logs, decoded events, derived pools and a contiguous scanned range commit in one SQLite transaction. Every serving request verifies the last checkpoint. Alarms also verify that checkpoint before and after fetching the next interval. Reorgs remove the last affected range and invalidate cursors; repeated alarms walk back until a canonical checkpoint is found. RPC outages preserve existing data without falsely declaring completion.

The first read starts background backfill. Alarms scan up to 2,000 blocks and use at most 40 read RPCs. The 1952 RPC's 100-block log limit is respected by parallel subranges. A batch stops before the thirteenth event-bearing block to bound block/transaction verification. Backfill polls after one second; caught-up or temporarily failed actors poll after 30 seconds. New service-proven mining sources trigger an explicit generation reset and backfill from genesis; a temporary catalog outage never deletes known sources.

A response exceeding 1,000 logs in a single subrange is retried with a smaller range. A single block still exceeding that bound fails closed and reports `lastError`; it is not silently treated as fully indexed. This is a deliberate current resource bound, not unlimited indexing capacity.

## Validation and deployment

`npm run check` runs unit/SQLite behavior tests, lint and typecheck. `npm run test:index-runtime` runs isolated actual workerd SQLite Durable Objects: both chain actors, pagination 10/10/3, runtime restart, reorg rollback/cursor invalidation, and ERC20/NFT decoding. The fixture intercepts every outbound request and permits only read RPCs.

The test Wrangler configs add `CHAIN_INDEX` and migration `v1-chain-index-sqlite`. Deployment does not modify contracts or the mining/order service databases. Rollback can deploy the prior Worker without the binding; the SQLite namespace is preserved. A redeployment must never reuse a product deployment version for different 1952 root contracts.
