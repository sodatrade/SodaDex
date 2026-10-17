# Main swap flow

`GeneralSwapCard` is the main entry point. It retains the old card's wallet and built-in balance props and accepts an optional `onCreatePool` navigation callback.

- `CurrencyPicker` searches built-in assets, readable SodaDEX pool assets, revalidated imported addresses, and the optional `/api/reference/tokens` directory. Directory labels are discovery data: selection calls `importCurrency` before any amount is interpreted. Missing directory data does not disable built-in or manual selection. Known assets use bundled official icons; unknown assets use neutral initials.
- `domain/tokenCatalog.ts` stores only public token addresses, emits `TOKEN_CATALOG_CHANGED`, and supports removing an import. `useTokenCatalog` reads chain metadata again; stored decimals or names are never trusted.
- `routes.ts` matches initialized, non-empty SodaDEX pools. Auto quotes all matching single-pool routes and uses the largest successful output. Protocol selection restricts that set. A V3 WOKB pool preserves whether the user chose native OKB or the WOKB ERC-20; V4 native and wrapped currencies remain distinct.
- `TradeDetails` displays the actual fee, input-denominated fee estimate, reviewed minimum, slippage, and price impact calculated against that pool's current price after fees. The pool price is not an independent market reference. No fiat estimates are fabricated.
- `useSwapOperation` calls the domain's `executePoolTrade` or `executeWrap`. The UI does not build approvals or Router calldata. Every write requires the confirmation dialog and wallet approval; changing form state, closing review, changing account, or changing chain invalidates subsequent signing steps through the execution context.
- Broadcast hashes go into the shared public transaction journal. Pending transactions block another submission. Recovery and receipt checks only read the existing hash; confirmed approvals require a new review instead of automatically continuing.

Inputs use exact decimal parsing and actual token precision. ERC-20 Max uses the read balance. Native OKB has no Max control because this component does not estimate a changing multi-step gas reserve. The executor still simulates and verifies gas affordability before each wallet write.

Swap slippage starts at the existing 50 bps and can be edited. It does not affect 1:1 wrap/unwrap. The shared public-swaps switch is respected in the main button, confirmation, and domain execution. Read-only quotes remain usable when paused.

This module supports the project's registered V3 and hookless V4 pools. A reference token listing does not mean there is a SodaDEX pool, an official-pool transaction route, multi-hop aggregation, fiat purchase, bridge, or limit-order service.

Validation: `generalSwapRoutes.test.ts`, `generalSwapUi.test.tsx`, and `tokenCatalog.test.ts` cover pair discovery, native/wrapped intent, best successful route, import verification, arbitrary created pools, explicit confirmation, wallet/network/balance failures, pause behavior, state invalidation, and receipt-only recovery. Isolated browser fixtures inspect 1440, 768 and 390 px layouts and native dialog focus/Escape behavior. Main app integration and final Worker validation belong to the integration owner.
