# SodaDEX 1952 online mining service

This package is isolated from the 196 order service and production. The Worker has
no public `workers.dev` route. Only the 1952 frontend Worker's Service Binding
should call `/v1/*`, preserving the exact configured `Origin` and
`X-SodaDEX-Network-Profile: 1952-mining-test` headers.

**Integration prerequisite:** `cloudflare/discovery-adapter.ts` currently fails
closed with `discovery_not_wired`. The integration owner must connect the shared
`verifyMiningBase` / `resolveMiningProject` verifier before enabling admission or
execution. Unit fixtures inject a verifier; that does not establish public chain
integration.

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
- `src/planner.ts`: handles one approved business operation at a time in round
  robin order. Before graduation, unbooked FAB is recognized with `sync`, then
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
reserves project slots before signing; an expired issued authorization does not
silently free a slot because its transaction may already have been broadcast.
Reusing a request ID with another wallet or form is rejected. Reusing the exact
verified request returns the same stored authorization while valid.

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
fees retain the reserve and stop. A reorg of the latest finished execution
subtracts its prior spent amount, restores its full reserve, and reconciles the
same saved raw bytes first. SQL state is not a substitute for chain finality.

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
these pure/mocked integration tests. Public E2E requires the real verifier,
operator-approved configuration, injected Secrets and funded keeper; a disabled
bundle build does not establish that those workflows have been deployed.
