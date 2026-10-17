# Portfolio

`PortfolioPage` accepts the shared wallet, connect/swap/liquidity navigation callbacks, `initialTab`, `selectedAsset`, and optional `onTabChange`. Its exported `PortfolioTab` union is `overview | tokens | nfts | activity`. External tab changes update local selection without triggering navigation callbacks; user tab changes call `onTabChange`.

Balances and metadata come from the configured chain-196 RPC. `usePortfolioTokens` checks the RPC chain, revalidates saved token addresses with `importCurrency`, then reads balances independently. A failed read is unavailable (`—`), while an actual zero remains zero. The page never sums unlike token units or invents fiat value, PnL, or an asset chart.

Position counts and NFT rows use `listPositions(account)` from the project's two PositionManagers. A management action navigates to the liquidity page; NFT links point to the actual manager and token ID. These are SodaDEX position NFTs, not a scan of every NFT held by the wallet.

Activity embeds the existing `HistoryPage` with wallet and local-device filters. The wallet view covers indexed SodaDEX events; the local view covers this browser's public submission journal. Neither is labelled as complete external wallet history.

`SendDialog` separates input, exact-unit preview, and final wallet confirmation. The preview calls `buildTransfer` and reads an actual gas estimate; it never requests a wallet signature or broadcast. `useSendOperation` invokes `executeTransfer` only after explicit confirmation. The domain rechecks balance, identity, network, simulation and gas affordability before its wallet write. Closing the dialog or changing wallet identity invalidates further signing. The form also invalidates its original wallet snapshot when account or network changes before preview.

Broadcast hashes are immediately written to the shared journal. A transport error preserves the pending hash. Recovery and refresh only query that transaction with its original account and destination; no transfer is resent or automatically resumed. Proven success refreshes balances and activity. Proven reverts are terminal and require a new form review.

`ReceiveDialog` copies only the public address and labels the X Layer network. When clipboard access is unavailable or rejected, the address field is selected for manual copying.

Validation is separated into component interaction tests (`portfolioUi.test.tsx`), existing transfer-domain tests (`transfers.test.ts`), and an isolated browser fixture at 1440, 768 and 390 CSS pixels. The browser fixture contains public sample data, cannot sign, and does not establish deployed behavior. Final App routing and Worker acceptance belong to the integration owner.
