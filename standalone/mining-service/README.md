# SodaDEX 1952 online mining service

This package is isolated from the 196 order service and production. The Worker has
no public `workers.dev` route. The approved SodaDEX main frontend and legacy 1952
frontend use Service Bindings to call `/v1/*`, preserving the actual browser
`Origin` (which must exactly match a configured frontend origin) and
`X-SodaDEX-Network-Profile: 1952-mining-test` headers.

The unified main-site origin is explicitly added alongside the original 1952
origin; it is not substituted into old requests or signed messages. A launch
challenge includes the requesting origin. Challenge retries and launch requests,
including cached authorizations, must reconstruct the exact saved message for
that same origin. Existing schema-1 challenges continue to work at their original
site without migration. A signature issued at either site cannot be reused at
the other. Both sites use the same projects, quotas, budgets, recovery records
and Durable Object; adding an entry point does not reset any of them.

`cloudflare/discovery-adapter.ts` connects the shared chain verifier. Root runtime,
proxy/beacon implementation, factory ownership and project bindings are checked
at one canonical block. Unit fixtures remain separate from real-chain evidence.

## Responsibilities and fund flow

- `src/admission.ts`: normalizes only name, symbol and metadata URI; binds one
  readable 300-second challenge to origin/deployment/wallet/request/form; verifies
  the wallet's personal signature; rechecks the fixed chain deployment and signer;
  signs the exact approved Manager launch parameters. It returns only that
  wallet's canonical `{from,to,data,value:'0x0'}` transaction. The wallet pays gas.
  Contract wallets/ERC-1271 are explicitly unsupported in this version.
- `src/directory.ts`: accepts only a successful canonical receipt from the fixed
  Manager, joins its creation/graduation event to verified factory/Manager/project
  bindings at the same block, and persists the public project identities. A
  refresh can only target an already registered project. The deployment version
  stays fixed; directory revisions change separately. Plain `GET /projects` and
  `GET /status` read SQL snapshots without RPCs or waiting behind keeper work.
- `src/planner.ts`: examines one project or the shared farm per alarm in round robin
  order. An idle or failed candidate advances the cursor without scanning the
  rest in that same event; this bounds RPC requests and prevents starvation. Before graduation, unbooked FAB is recognized with `sync`, then
  `fundFarm`; bounded `syncVault` calls catch up older farm history first. After
  graduation, project-token tax is converted on the verified pair, with the 1%
  transfer tax applied before router quotation, and explicit slippage applied to
  the quoted FAB output. The proceeds stay in the immutable project vault.
- Procurement considers only explicitly listed IDs, the configured test inventory
  seller, the current NFT owner/approval/eligibility, farm capacity, contract FAB
  budget and explicit price/spending limits. `products.json.testListingIds` are
  reserved for individual user purchases and are always excluded. It never scans
  arbitrary market listings. Router input is rounded up within explicit slippage;
  `maxProcurementFabRaw` bounds **lifetime** `farm.procurementSpent()` plus the new
  maximum input, rather than resetting the contract's existing spent amount.
- The existing authorizer **S** signs only launch, purchase and conversion
  authorizations. Purchase/conversion EIP-712 digests must match the contract's
  own digest getter, with an expiry no more than 60 seconds ahead. A separate
  keeper signs only the fixed farm/vault operations and pays gas. The owner key
  is never needed by this package.

## Verified public test operation

The 2026-10-18 online phase is enabled on the independent 1952 frontend. Public
acceptance created TEST-ONLINE through this service, graduated its curve, ran
post-graduation buys/sells, procured the two approved miners, converted tax and
funded the farm. The owner received 5.98386921 TEST-FAB with matching payment
and ERC-20 events, withdrawn accounting and balance delta. The owner completed
25 transactions including asset preparation, within its 0.0005 TEST OKB ceiling.
The keeper remains enabled under its separate cumulative 0.0005 ceiling.

[Public acceptance and current addresses](../../deployments/xlayer-1952/2026-10-18-online-acceptance.json)
separates public CLI receipts, local browser evidence and timestamped ongoing
keeper costs. The approved execution plan is retained as its immutable snapshot;
its pre-execution readiness fields are historical. Do not reset/replay a CLI
journal to repeat an acceptance run. Users can test through the normal frontend
within the approved project and inventory limits. Production and chain 196 remain
outside this service.
Both allowlisted listings have been consumed. Further automatic purchases need
additional approved inventory; the reserved retail listing remains available
for manual frontend testing.

## Explicit configuration

The 2026-10-18 online phase was explicitly approved for 1952 only. The checked-in
configuration reserves a dedicated keeper ceiling of 0.0005 TEST OKB, with
admission/execution enabled after its exact two-miner inventory and
9,000 TEST-FAB liquidity were prepared and verified in 14 public testnet transactions. The whole new phase has a
0.001 TEST OKB gas ceiling, split equally between owner and keeper. The owner
key remains in its local encrypted keystore; only the dedicated 1952 authorizer
and keeper Secrets are stored in Cloudflare.

The approved policy allows three total projects, at most two per wallet, market
listing IDs 3 and 4 from the approved owner, lifetime procurement input at most
2 TEST-FAB, and 0.5% slippage. Listing 2 remains reserved for individual testing.
These settings are test-specific, never production defaults. `GET /status`
reports the effective operating flags and cumulative budget; `serviceBuild`
identifies the responding service code separately from the fixed deployment
identity. A saved configuration or successful upload is not proof that a running
Durable Object has picked up its new settings.

| Variable | Meaning |
| --- | --- |
| `MINING_PUBLIC_ORIGIN` | Original exact 1952 frontend origin; retained for existing challenges |
| `MINING_ADDITIONAL_PUBLIC_ORIGINS` | Optional JSON array of additional exact HTTPS frontend origins; no paths, wildcards or duplicates. Omission permits only the original origin. |
| `MINING_ADMISSION_ENABLED` | Explicit `true` or `false` |
| `MINING_EXECUTION_ENABLED` | Explicit `true` or `false` |
| `MINING_SIGNER_PRIVATE_KEY` | Cloudflare Secret for the existing fixed 1952 authorizer S only |
| `MINING_KEEPER_ADDRESS` / `MINING_KEEPER_PRIVATE_KEY` | A separate dedicated 1952 gas wallet and its Secret |
| `MINING_GAS_CAP_WEI` | Cumulative actual plus reserved keeper gas ceiling |
| `MINING_MAX_GAS_PER_TRANSACTION` | Maximum estimated gas including 20% gas-unit headroom |
| `MINING_MAX_GAS_PRICE_WEI` | Explicit gas price ceiling |
| `MINING_EXPIRED_RECOVERY_HASH` | Optional; only the separately approved exact 1952 expired execution hash is accepted |
| `MINING_POLL_MS` | Explicit alarm interval, at least 1,000 ms |
| `MINING_OPERATING_POLICY` | Exact JSON object below, or `policy_pending` |

The operating policy requires all of these fields. Raw FAB values have 8 decimals;
project tokens have 18 decimals; native amounts are wei. These are operator inputs,
not production defaults:

```text
maxProjects: integer
maxProjectsPerWallet: integer
allowedListingIds: decimal-string[]
inventorySeller: address
maxProcurementFabRaw: decimal-string
maxMinerPriceWei: decimal-string
maxConversionInputRaw: decimal-string
slippageBps: integer
```

The chain, RPC and authorizer are fixed to the verified 1952 deployment. The
cloud runtime cannot override them with 196/production values. Local integration
may explicitly inject a different authorizer only when both origin and RPC are
strict `http://127.0.0.1` URLs and `validateConfig(..., true)` is used. Cloudflare
never takes that path.

## Persistence, recovery and budget

One SQLite Durable Object, `SodaMining1952`, owns challenges, authorizations,
projects, jobs, signed executions and budget counters. Mutating requests and
alarms are serialized; synchronous SQL mutations are transactional. Admission
reserves project slots only after wallet proof. Unverified challenges form a
bounded replaceable cache and cannot lock a wallet. After the chain has passed
an authorization deadline, canonical Factory logs prove whether creation happened.
Already-created projects are registered; uncreated requests become expired
tombstones and release their reservations. A reorg invalidates that expiry proof
and restores its reservation. Old request IDs are never authorized again.
Reusing a request ID with another wallet, form or origin is rejected. Reusing the exact
verified request returns the same stored authorization while valid.

Expiry history does not add one RPC per old request to every new launch. Existing
schema-1 databases first validate their saved expiry proofs under one canonical
snapshot, at most eight distinct `(block number, hash)` groups per mutating request.
Requests sharing a proof use one header read. The scan cursor and snapshot are
durable across restarts; `expiry_reconciliation_pending` (HTTP 503) blocks new
admission until subsequent challenge/launch requests finish that work. Snapshot
GETs never advance this scan. Only a completed scan establishes a common ancestor
anchor; a later canonical proof alone cannot certify earlier legacy proofs.

Once established, one anchor check covers that fully verified history. An anchor
or in-progress snapshot reorg restores **all** released reservations atomically
and flushes them before further RPCs. Reconciliation then handles at most one
expired authorization per event, including recovery of a created-but-unregistered
project. An RPC failure retains the cursor/reservations; retry continues the work
without deleting tombstones or making old request IDs reusable. The eight-proof
read batch leaves the rest of the event budget for root validation, canonical
checks and the single project recovery/launch path.

A keeper operation first verifies the current bindings and simulates. A failed
simulation, insufficient budget/balance, unknown nonce, fee-model change or price
limit prevents the keeper signature/broadcast. The signed raw transaction, hash,
nonce and full gas reserve are persisted and flushed **before** any broadcast.
Only one unresolved keeper execution can be prepared.

On restart or a lost response, recovery checks the original hash and its canonical
receipt. It never signs another nonce to replace an unknown transaction. At most
one identical raw rebroadcast is allowed after the original send attempt; if still
unknown, it stays blocked with its full reserve. A pending/consumed unknown nonce
also blocks new execution. An expired stored authorization is retained and not
broadcast again. These states require reconciliation rather than deleting rows.

The separately approved 2026-10-18 exception is opt-in through
`MINING_EXPIRED_RECOVERY_HASH`, accepted only for
`0x0fb7c2a1a0a532e8531744e408a31422b2e0c43a93ed8847e7eec3a46707c3a5`.
It adds no HTTP/admin signing endpoint. `src/expired-recovery.ts` first validates
that saved raw/hash/signer/nonce/calldata, the true EIP-712 deadline/signature and
contract digest, unused conversion nonce, canonical 1952 runtime/project binding,
and empty-code keeper. The chain timestamp must be **strictly later** than the
authorization deadline; a server clock alone never proves permissionless expiry.

Only then may the same keeper sign one separately persisted legacy cancellation:
same nonce, recipient itself, zero value, empty calldata, fixed 30,000,000-wei gas
price within the existing ceiling. Its estimation/simulation uses the canonical
empty-code proof block, whose ancestry is checked again before broadcast. Ordinary
contract calls retain the stricter pending-state code/freshness probes. The
original raw transaction is never replayed by this recovery path. A price that
cannot replace the original, unknown nonce/pending state, changed code, insufficient
balance/full additional reserve, or failed proof stops it without relaxing limits.

Original and cancellation raw/hash records remain linked; both maximum reserves
stay held until one unique canonical receipt wins. Only the winner's actual fee
is charged, once; the other row is retained as replaced. The original winning
still settles normally. Cancellation winning marks the original business job
`failed / authorization_cancelled`, never a successful tax conversion. The next
alarm may obtain a fresh quote and fresh business authorization. Lost responses
or restarts reuse the same cancellation hash/raw, with at most the existing one
identical rebroadcast. A receipt reorg atomically reverses winner costs and
restores **both** linked reserves before any further reads or new planning.
Schema-1 storage, prior spending, deployment identity and DO namespace remain.

New purchase/conversion calls also compare their deadline against a fresh chain
head **after** slow discovery/simulation/estimation and before keeper signing or
persisting. Same-event canonical proof checks are reused; restarts still perform
complete live verification. Signature lifetime stays 60 seconds. This prevents
known-expired newly prepared rows without discarding existing signed history.

Successful and reverted canonical receipts both charge actual
`gasUsed * effectiveGasPrice + l1Fee + operatorFee`, releasing only the known unused
reserve. The zero L1/operator fee model is checked against GasPriceOracle **and**
L1Block before signing and at the receipt block. Unknown or larger-than-reserved
fees retain the reserve and stop. The most recent settled block anchors the earlier receipts. If that ancestor
anchor changes, all affected settled costs return to full reserves atomically
before their canonical receipts are rechecked; earlier re-mined transactions
therefore cannot hide an increased gas cost. Saved raw bytes remain unchanged. SQL state is not a substitute for chain finality.

Waiting conditions such as no tax, no approved inventory or a full farm consume
read RPCs but do not send empty transactions. `/run` only queues existing fixed
business work; it accepts no target, calldata, recipient, digest or client price.
Private signatures/raw transactions never appear in directory/status responses
or normal logs. Durable storage remains private; do not publish a database export.

## Validation and operation

```sh
npm --prefix standalone/mining-service run check
npm --prefix standalone/mining-service run build:cloudflare
npm --prefix standalone/mining-service run dev:cloudflare
```

The package has its own lockfile and does not require the upstream monorepo
installation. The Wrangler commands use the sibling standalone Worker's existing
Wrangler installation and set `--cwd cloudflare`; this also avoids Wrangler's
relative `tsconfig` resolution issue for nested configs.

Targeted tests cover challenge replay/request conflicts, wallet/signature/domain
binding, receipt spoofing/reorg rejection, fixed inventory/capacity/approval checks,
tax-input/slippage bounds, budget exhaustion, simulation failure, raw persistence,
response loss/restart, nonce conflicts, canonical success/revert costing and reorg
reserve restoration. Real local Wrangler/SQLite restart smoke is separate from
these pure/mocked integration tests. Public E2E requires
operator-approved configuration, injected Secrets and funded keeper; a disabled
bundle build does not establish that those workflows have been deployed.

## Isolated browser integration

`npm --prefix standalone/mining-service run dev:local` runs only against Anvil at
`http://127.0.0.1:8954/` and serves `http://127.0.0.1:8791` for the exact browser
origin `http://127.0.0.1:5173`. It requires the separately exported
`.analysis/mining-1952/browser-online-fixture` manifest and the `loopback-online-`
version prefix. It refuses non-Anvil chains. All three local accounts are public
deterministic test accounts; the tool never reads the owner's wallets or Secrets.

Business contracts execute their real bytecode. The local fixture supplies named
zero-surcharge OP fee predeploys as infrastructure only; public fee-model checks
must still pass independently. Local economic limits and Anvil-funded balances
are test fixtures, not approved public-service or production settings. State uses
a private SQLite file under `.analysis/mining-online/local-service/`; a deployment
version mismatch refuses to reuse it. No browser or service retry clears that state.

The HTTP adapter batches at most ten ordinary RPC reads (the official endpoint
was checked with ten; a batch of 23 was rejected). Pending simulations use one
eight-call chain/header/code/nonce probe. Each cloud event stops before exceeding
45 upstream fetches. A same-event planner proof may be reused for its first
broadcast after a canonical-block check; restart/rebroadcast always verifies live
root and project identities again. Successful cycles clear stale service-level
errors; per-transaction jobs and receipts remain persisted.

### Recovery request-budget evidence

The private Cloudflare alarm still stops after 45 upstream HTTP fetches. The
real read-only 1952 adapter measurement at block `0x29cd0d3` used 12 fetches for
`verifyMiningBase` and 10 for `resolveMiningProject(TEST-WALLET)`. Focused tests
exercise the remaining real `HttpRpc` batching: cancellation preparation/broadcast
uses 12, while a fresh conversion uses 21. Including the two-fetch settled
ancestor check gives composed normal-path bounds of 36 and 45 respectively.
Discovery itself is mocked in those focused transport tests; the separately
measured live baseline is added explicitly, so this is a composed bound rather
than a claimed live full recovery run. Stale pending retries consume the same
45-fetch ceiling and fail closed; it is never increased. Any already signed row
retains its raw/hash and reserve if a later network read fails.
