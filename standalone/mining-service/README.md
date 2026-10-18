# SodaDEX 1952 online mining service

This package is isolated from the 196 order service and production. The Worker has
no public `workers.dev` route. Only the 1952 frontend Worker's Service Binding
should call `/v1/*`, preserving the exact configured `Origin` and
`X-SodaDEX-Network-Profile: 1952-mining-test` headers.

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

## Explicit configuration

The checked-in configuration has admission/execution disabled, a zero gas cap,
no keeper, and `policy_pending`. It must remain that way until the test operator
has approved the next phase's bounds. The earlier deployment gas budget is not a
new keeper budget. No default economic or spending parameters are inferred.

| Variable | Meaning |
| --- | --- |
| `MINING_PUBLIC_ORIGIN` | Exact 1952 frontend origin |
| `MINING_ADMISSION_ENABLED` | Explicit `true` or `false` |
| `MINING_EXECUTION_ENABLED` | Explicit `true` or `false` |
| `MINING_SIGNER_PRIVATE_KEY` | Cloudflare Secret for the existing fixed 1952 authorizer S only |
| `MINING_KEEPER_ADDRESS` / `MINING_KEEPER_PRIVATE_KEY` | A separate dedicated 1952 gas wallet and its Secret |
| `MINING_GAS_CAP_WEI` | Cumulative actual plus reserved keeper gas ceiling |
| `MINING_MAX_GAS_PER_TRANSACTION` | Maximum estimated gas including 20% gas-unit headroom |
| `MINING_MAX_GAS_PRICE_WEI` | Explicit gas price ceiling |
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
Reusing a request ID with another wallet or form is rejected. Reusing the exact
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
