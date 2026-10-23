# Independent 196 test rehearsal

This command has no public broadcast mode. It starts its own Anvil on loopback port
8956, pins a current 196 block, and verifies that every local RPC still belongs to
that child PID. Existing test chains on other ports are untouched. The real owner
is impersonated only inside this fork; admission signatures use a fresh memory-only
account. Neither the owner's key nor the 1952 signing key is read.

```sh
node --experimental-strip-types scripts/sodadex/rehearse-mining-196.mjs \
  --source-root /absolute/SodaDex \
  --product-manifest /absolute/196-product-artifacts.json \
  --reuse-manifest /absolute/196-reuse.json \
  --output /absolute/new-rehearsal.json
```

Required artifact manifest: `schemaVersion: 1`, `chainId: 196`, `sourceRoot`, and
`artifacts[name] = {file, sha256, sourceRoot?}`. Each file and its compiler source
hashes are checked. The `V2Graduation` entry must explicitly resolve to the isolated
mining-test implementation; the production library retains its canonical venue lock.

Required reuse manifest: `chainId: 196`, `stage: "test-196"`, and `contracts` containing
`wrapped`, `permit`, `pm`, `positionManager`, `quoter`; each has `address` and
`runtimeSha256` (SHA-256 over runtime bytes, not hex text). Addresses must match the
existing SodaDEX 196 test deployment, and PositionManager bindings are checked.

The fork creates a new FABX history-V2 stack directly, its own V2 factory/router,
a new IGNIX manager, mining factory/farm, and fragment vault/pool. It never upgrades
an existing contract. It exercises real NOT proofs, mining, signed fundraising,
procurement, graduation, LP, taxes, dividends and fragments.

The native amounts are a proposal: 1,000 newly created TEST-FAB with 0.00000001 OKB
in the independent seed pool, and 0.000000000001 OKB per test miner. These are test
prices, not market prices. The fixed minimum supported fees remain in test-196.json.

The output records all transactions, receipts, gas estimates/limits, L1/operator
fees, grouped costs, principal, recoverable wrapped native and the pinned block.
The backend calls are a subset of the measured business acceptance, never added
twice. An optional second-business-run allowance is separate. This is contract
execution evidence, not browser proof. Actual deployment needs a dedicated persistent
signer, another full rehearsal with that address, refreshed gas/nonce/runtime checks,
and the user's explicit budget approval. No amount in this output authorizes spending.
