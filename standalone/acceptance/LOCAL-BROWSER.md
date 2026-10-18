# Local browser acceptance

These adapters serve the real SodaDEX application with an EIP-6963 wallet named
**本地 Anvil 测试钱包**. Open the local URL and use the application's normal wallet
picker. No browser script injection, extension, existing wallet key, public RPC,
or public-chain transaction is involved. The persistent on-screen label identifies
the local fixture; the chain ID remains 196 so the actual contract bindings run.

The provider forwards exact wallet requests to `/fixture-wallet`. Each server
checks the numeric loopback host, origin, request marker, owned Anvil PID/client,
chain ID, account, transaction fields, native amount cap and the compiled Worker's
simulation policy. Orders additionally validate the canonical typed-data digest
and the settlement contract before signing with an ephemeral in-memory account.
The provider is acceptance-only and is never included in a production build.

Use Node 22.23.2 and the installed web/worker/orders dependencies. Set these paths
to the existing public rehearsal fixtures (the example uses the primary checkout):

```sh
export PATH=/Users/LevyHoo/.nvm/versions/node/v22.23.2/bin:$PATH
export SODADEX_LP_FORK_STATE=/Users/LevyHoo/Documents/SodaDex/.analysis/branding/browser-fork-state.json
export SODADEX_LP_STATEVIEW_CODE=/Users/LevyHoo/Documents/SodaDex/.analysis/lp-stateview.json
export SODADEX_TRADE_RUNTIMES=/Users/LevyHoo/Documents/SodaDex/.analysis/exact-output/quoter-runtimes.json
export SODADEX_ORDER_FEE_ORACLE_FILE=/Users/LevyHoo/Documents/SodaDex/.analysis/orders/fee-oracle-fixture.json
```

For swaps, wrapping, sending and LP operations, build the web app then start:

```sh
npm --prefix standalone/web run build:unified
node --experimental-strip-types standalone/acceptance/start-browser-fork.mjs 4173
```

Open `http://127.0.0.1:4173/`. This starts its own disposable offline Anvil,
installs the active StateView/quoter runtimes, compiles the Worker and serves
`standalone/web/dist`. Stop with Ctrl+C; it removes its temporary worker bundle
and stops only its own child processes. A new start gives a fresh chain state.
An isolated worker worktree may set `SODADEX_FIXTURE_ASSETS` to the primary
checkout's already-built `standalone/web/dist` for a read-only asset mount.

For limit orders, `.analysis/orders/settlement.json` must contain the compiled
test settlement artifact. The server starts a separate Anvil, Vite and SQLite
service, with an ephemeral funded maker and keeper:

```sh
node --experimental-sqlite --experimental-strip-types standalone/acceptance/orders-server.mjs 4196
```

Open `http://127.0.0.1:4196/#swap` and select the limit-order tab. Stop with Ctrl+C to close the local service,
Anvil and temporary database. The browser uses the actual order signing and
submission UI. The keeper is enabled, so an executable order may fill promptly.
Use a non-executable target when checking cancellation.

Acceptance adapter checks:

```sh
node --test standalone/acceptance/fixture-provider.test.mjs
node standalone/acceptance/check-fixture-guards.mjs http://127.0.0.1:4173
node standalone/acceptance/check-fixture-guards.mjs http://127.0.0.1:4196
```

The guard checks send only invalid intents and assert no new transaction or
signature. `/fixture-status` records real local transaction hashes and, for
orders, signature digests. Use receipts/balance changes plus browser interactions
for business acceptance; adapter/unit checks alone are not browser E2E evidence.
Do not execute the older Playwright scripts when the active browser workflow is
CUA; they may be read as a checklist instead.
