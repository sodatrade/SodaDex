# Liquidity UI

`LiquidityPage` accepts the existing `WalletController`, `onConnect` and `onSwap`. The owner App mounts it inside the existing QueryClient and Preferences providers. It imports only the local `src/liquidity` client; no Uniswap hosted API is used. Swap availability does not gate LP withdrawals or fee collection.

Pool / position reads use React Query keys beginning with `liquidity`. The wizard and position dialogs adapt decimal strings to exact integer units and delegate currency mapping, tick alignment, liquidity math, default slippage, preview and transaction encoding to the client. V3 native OKB is represented by the client with WOKB address plus `native: true`.

The position display uses client `claimable0/1`, which can include previously withdrawn V3 principal held in `tokensOwed`; it does not label that total as pure fees.

The UI mutation controller requires a fresh client preview and explicit wallet confirmation. Account / network changes invalidate the preview; closing or unmounting increments the request revision so later steps cannot continue. It preserves the last submitted public hash before receipt polling. `transactionRecord.ts` validates and stores one public transaction record for reload recovery; any pending record prevents another LP submission until its receipt is checked. Recovery never resumes approvals or sends transactions. Storage failure leaves the current session usable and exposes the explorer link.

The shared history journal is owned by the App integration. Its adapter can record the same public `hash/from/to/kind/status` at `useLiquidityOperation` progress and completion events; this feature does not implement a second history list.

`liquidityUi.test.tsx` mocks the client boundary to cover user consent, exact decimal adaptation, operation selection, defaults / override, identity changes, errors and pending recovery. It does not prove chain execution. The owner runs the final responsive browser and Worker / fork integration after mounting this page with the client implementation.
