# SodaDEX

SodaDEX is a fork of [Uniswap/interface](https://github.com/Uniswap/interface), maintained in [sodatrade/SodaDex](https://github.com/sodatrade/SodaDex).

The application is labelled **SodaDEX Test**, for personal learning and noncommercial testing. Its independent interface in [`standalone/web`](standalone/README.md) uses a same-origin read/simulation proxy for `https://rpc.ignix.bot/rpc/196`. SodaDEX-branded NFT contracts and two funded v3/v4 test pools are deployed on **X Layer mainnet (chain ID 196)**. Both pools passed real micro swaps in both directions. Current addresses and receipts are in the [deployment address table](deployments/xlayer-test/ADDRESSES.md); the frontend and Worker share [`active.json`](deployments/xlayer-test/active.json) and verified `pools.json`. The preserved upstream application in `apps/web` still uses Uniswap APIs and contract mappings.

The source baseline is `web/5.166.0`, commit `6f54d9a474a6036e7043ed52f2a9359003c96c9c`. Preserve upstream licences, notices, protocol identifiers, and SDK package names.

Test preview: [sodadex-preview.jsmsdx2025.workers.dev](https://sodadex-preview.jsmsdx2025.workers.dev). The interface supports wallet connection, balance reads and reviewed swaps through the verified SodaDEX pools. Adding liquidity through the interface remains unavailable. Hosting is published manually, without a custom domain or deployment CI. See the [local runbook](standalone/README.md) and [hosting receipt](deployments/frontend-test.json).

```bash
git clone https://github.com/sodatrade/SodaDex.git
cd SodaDex
```

Use the Node and Bun versions in `.nvmrc` and `.bun-version`. The current public upstream snapshot references a missing `tools/uniswap-nx` workspace, so `bun install --frozen-lockfile` fails before installing dependencies. The upstream monorepo checks remain blocked; independent SodaDex validation and test hosting are documented in the [standalone runbook](standalone/README.md).

## Upstream documentation

### Uniswap Labs: Front End Interfaces

This is the **public** repository for Uniswap Labs’ front-end interfaces, including the Web App, Wallet Mobile App, and Wallet Extension. Uniswap is a protocol for decentralized exchange of Ethereum-based assets.

## Interfaces

- Web: [app.uniswap.org](https://app.uniswap.org)
- Wallet (mobile + extension): [wallet.uniswap.org](https://wallet.uniswap.org)

## Install & Apps

```bash
git clone git@github.com:Uniswap/interface.git
bun install
bun web start
```

For instructions per application or package, see the README published for each application:

- [Web](apps/web/README.md)
- [Mobile](apps/mobile/README.md)
- [Extension](apps/extension/README.md)

## Contributing

For instructions on the best way to contribute, please review our [Contributing guide](CONTRIBUTING.md)!

## Socials / Contact

- X (Formerly Twitter): [@Uniswap](https://x.com/Uniswap)
- Reddit: [/r/Uniswap](https://www.reddit.com/r/Uniswap/)
- Email: [contact@uniswap.org](mailto:contact@uniswap.org)
- Discord: [Uniswap](https://discord.com/invite/uniswap)
- LinkedIn: [Uniswap Labs](https://www.linkedin.com/company/uniswaporg)

## Uniswap Links

- Website: [uniswap.org](https://uniswap.org/)
- Docs: [uniswap.org/docs/](https://docs.uniswap.org/)

## Whitepapers

- [V4](https://uniswap.org/whitepaper-v4.pdf)
- [V3](https://uniswap.org/whitepaper-v3.pdf)
- [V2](https://uniswap.org/whitepaper.pdf)
- [V1](https://hackmd.io/C-DvwDSfSxuh-Gd4WKE_ig)

## Production & Release Process

Uniswap Labs develops all front-end interfaces in a private repository.
At the end of each development cycle:

1. We publish the latest production-ready code to this public repository.

2. Releases are automatically tagged — view them in the [Releases tab](https://github.com/Uniswap/interface/releases).

## 🗂 Directory Structure

| Folder      | Contents                                                                       |
| ----------- | ------------------------------------------------------------------------------ |
| `apps/`     | The home for each standalone application.                                      |
| `config/`   | Shared infrastructure packages and configurations.                             |
| `packages/` | Shared code packages covering UI, shared functionality, and shared utilities.  |
