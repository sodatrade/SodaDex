# AGENTS.md

This file provides guidance to AI agents when working with code in this repository. Always run all tests, lint, and typecheck after making changes, and before considering a task to be 'complete'.

The runnable application in this snapshot is `standalone/`. Root `bun install` cannot succeed: the `tools/uniswap-nx` workspace is not in the tree. Use the commands in [Cursor Cloud specific instructions](#cursor-cloud-specific-instructions). Do not treat the upstream `bun web` / `bun g:test` shortcuts below as working until that workspace exists.

## Project Overview

Uniswap Universe is a monorepo containing all Uniswap front-end interfaces:

- **Web** (`apps/web/`) - Decentralized exchange web interface
- **Mobile** (`apps/mobile/`) - React Native app for iOS/Android
- **Extension** (`apps/extension/`) - Browser wallet extension

## Common Development Commands

### Setup

```bash
# Initial setup
bun install
bun local:check
bun config:login
```

### Development Servers

```bash
bun web dev        # Web with Vite
bun mobile ios          # iOS app
bun mobile android      # Android app
bun extension start     # Extension
```

### Building

```bash
bun web build:production    # Web production build
bun mobile ios:bundle            # iOS bundle
bun mobile android:release       # Android release
bun extension build:production   # Extension production
```

### Testing

```bash
bun g:test                      # Run all tests
bun g:test:changed              # Run tests for changed packages
bun web playwright:test         # Web E2E tests
bun mobile e2e                  # Mobile E2E tests
```

### Code Quality

```bash
bun g:lint:fix                  # Fix linting issues
bun g:typecheck                 # Type check all packages
bun g:format                    # Fix formatting
bun i18n:extract                # Extract localized strings (run after changing translations)
```

## Architecture Overview

### Monorepo Structure

- **NX** for build orchestration
- **Bun workspaces** for package management
- Shared code in `packages/` directory
- App-specific code in `apps/` directory

### Key Technologies

- **TypeScript** everywhere
- **React** for web/extension
- **React Native** for mobile
- **Redux Toolkit** for state management
- **Ethers.js/Viem** for blockchain interactions

### Code Organization Principles

#### Styling

- **ALWAYS** use `styled` from `ui/src` (never styled-components); UI components may use inline styling where appropriate
- Use theme tokens instead of hardcoded values
- Platform-specific files: `Component.ios.tsx`, `Component.android.tsx`, `Component.web.tsx`, `Component.native.tsx` (with stub files for platforms where specific implementation isn't needed)

#### State Management

- **Redux** for complex global state
- **Zustand** for simple global/shared state — do not use Jotai, we are migrating away from it. Flag any new Jotai usage in PRs and require Zustand instead.
- Keep state as local as possible
- No custom hooks for simple data fetching - use `useQuery`/`useMutation` directly

#### Component Structure

1. State declarations at top
2. Event handlers after state
3. Memoize properly, especially for anything that might be used in the React Native app
4. JSX at the end
5. Keep components under 250 lines

#### TypeScript Conventions

- Do not use `any`, prefer `unknown`
- Always consider strict mode
- Use explicit return types
- PascalCase for types/interfaces
- camelCase for variables/functions
- String enums with initializers

## Testing + Formatting Guidelines

- Test behaviors, not implementations
- Always update existing unit tests related to changes made
- Run tests before considering a task to be 'complete'
- Also run linting and typecheck before considering a task to be 'complete'
- Don't ignore new lint warnings — fix them; suppress with a one-line reasoned `oxlint-disable-next-line` only when a proper fix would change behavior
- Run `bun i18n:extract` after making changes to localized strings (e.g., using translation hooks like `useTranslation`)

## Critical Development Notes

1. **Environment Variables**: Override URLs in `.env.defaults.local` (mobile) or `.env` (extension)
2. **Pre-commit Hooks**: Use `--no-verify` to skip or set `export LEFTHOOK=0` to disable
3. **Python Setup**: Run `brew install python-setuptools` if you encounter Python module errors
4. **Mobile Development**: Always run `bun mobile pod` after dependency changes
5. **Bundle Size**: Monitor bundle size impacts when adding dependencies
6. **Bun Version Bumps**: `.bun-version` is the single source of truth. After editing it, run `bun sync:bun-version` to rewrite the pins that can't read the file (`engines.bun`, EAS build profiles) — CI fails if they drift. CI runners install Bun via `oven-sh/setup-bun` (reading `.bun-version` directly), so they need no pin. Bump `@types/bun` and rerun `bun install` separately.

## Package Dependencies

Core shared packages:

- `packages/ui/` - Cross-platform UI components and theme
- `packages/uniswap/` - Core business logic and utilities
- `packages/wallet/` - Wallet functionality
- `packages/utilities/` - Common utilities

## Blockchain Integration

- Support for multiple chains (Ethereum, Arbitrum, Optimism, etc.)
- Uniswap Protocol v2, v3, v4, and UniswapX support
- Multiple wallet providers (WalletConnect, Metamask, etc.)
- Transaction building and gas estimation

## Other Considerations

Be cognizant of the app or package within which a given change is being made. Be sure to reference that app or package's respective `AGENTS.md` file and other local configuration files, including (but not limited to): `package.json`, `tsconfig.json`, etc.


<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- You have access to the Nx MCP server and its tools, use them to help the user
- When answering questions about the repository, use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable.
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies
- For questions around nx configuration, best practices or if you're unsure, use the `nx_docs` tool to get relevant, up-to-date docs. Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the `nx_workspace` tool to get any errors


<!-- nx configuration end-->

## Cursor Cloud specific instructions

### Branches

`main` is the production branch and the only long-lived branch. There is no `master`, `dev`, or `develop`. Other remote heads are feature or hotfix branches.

Pushing a branch or opening a pull request does not deploy. `.github/workflows/tag_and_release.yml` runs only on `workflow_dispatch`. Publishing the site is the manual command `npm --prefix standalone/worker run deploy:production`, which refuses a dirty tree and any commit that is not remote `main`. Do not run `deploy:production`, `deploy:test`, or `wrangler deploy`. `deploy:test` is disabled because it targets the production worker. Local dev must stay on `wrangler dev --local`. Do not pass `--remote`.

### Install

`.cursor/install.sh` is idempotent and does not deploy. It links Bun 1.3.14, Foundry, and Solidity `solc-0.8.26` into `/usr/local/bin` when missing, then installs the four standalone packages and builds the test web bundle:

```bash
bash .cursor/install.sh
```

`npm ci` in those packages needs `--legacy-peer-deps`. Without it, `standalone/web` fails because transitive `hardhat-watcher` declares a `hardhat` peer that is not in the lockfile. The script then runs `npm --prefix standalone/web run build:dex-test`, which writes gitignored `standalone/web/dist/` including `preferences-script.json`.

The image Node is v22.23.4, which satisfies standalone `engines` (`>=22.22.2`). `.nvmrc` still pins `v22.22.2` for the upstream monorepo check. Root `bun install` fails before fetch with `Workspace not found "tools/uniswap-nx"`. `bun web dev`, `bun g:test`, `bun g:typecheck`, and mobile/extension commands are not runnable in this snapshot.

### Checks

```bash
npm --prefix standalone/web run typecheck
npm --prefix standalone/web run lint
npm --prefix standalone/web test
npm --prefix standalone/web run build:dex-test
npm --prefix standalone/worker run check
npm --prefix standalone/orders run check
npm --prefix standalone/mining-service run check
npm --prefix standalone/mining-service run test:retirement
forge test --root contracts/sodadex-fragments --use /usr/local/bin/solc-0.8.26 --offline
forge test --root contracts/sodadex-fragments-production --use /usr/local/bin/solc-0.8.26 --offline --no-match-contract SodaFormalForkTest
```

Run the web build before `standalone/worker` typecheck. The worker imports `standalone/web/dist/preferences-script.json`.

### Dev server

```bash
bash .cursor/start.sh
```

This listens on `http://127.0.0.1:8787` using `standalone/worker/wrangler.fragments-196-test.jsonc` in local mode. `npm --prefix standalone/worker run dev` uses `wrangler.jsonc`, which has no `viem` alias, so that bundle fails. `GET /api/network` and `POST /api/rpc` (`eth_chainId` / `eth_blockNumber`) are read-only checks against X Layer (chain id `0xc4` / 196).

### Gotchas

- Set `LEFTHOOK=0` for commits in Cloud Agent sessions. Hooks have no TTY.
- Login shells skip `~/.bashrc`. Use the `/usr/local/bin` links; do not rely on Bun or Foundry only being on `~/.bun` or `~/.foundry`.
- Web Vitest skips Anvil fork files unless `SODADEX_LP_FORK_STATE`, `SODADEX_LP_STATEVIEW_CODE`, and `SODADEX_TRADE_RUNTIMES` point at local fixtures. Those fixtures are not in Git. A skip is not an LP integration pass.
- `contracts/sodadex-orders` Foundry tests need `python3 scripts/sodadex/build-orders-fixtures.py` and forge-std under gitignored `.analysis/orders/deps`. A fresh clone cannot compile them.
- `SodaFormalForkTest` needs `SODA_FORMAL_FORK_RPC` and is outside the offline suite.
- Postgres, Redis, and Docker are not required. Anvil is only for the optional local fork fixtures.
- Do not rewrite lockfiles to make plain `npm ci` pass, and do not commit `standalone/web/dist`.

### Secret and env var names

Local install, unit tests, and `start.sh` need no secrets. Deploy and keeper runtime use these names (values stay out of Git and out of the frontend bundle):

- Wrangler on the owner machine, or `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` when Wrangler is authenticated from the environment
- `ORDERS_KEEPER_PRIVATE_KEY` (Cloudflare secret; must match `ORDERS_KEEPER_ADDRESS`)
- `ORDERS_EXECUTION_ENABLED`, `ORDERS_GAS_BUDGET_WEI`, `ORDERS_POLL_MS`, `ORDERS_PUBLIC_ORIGIN` (orders worker config, not key material)
- `MINING_SIGNER_PRIVATE_KEY` and `MINING_KEEPER_PRIVATE_KEY` (retired mining keeper; historical)
- `GITHUB_TOKEN` for the manual tag-and-release workflow only

Fixture paths, not credentials: `SODADEX_LP_FORK_STATE`, `SODADEX_LP_STATEVIEW_CODE`, `SODADEX_TRADE_RUNTIMES`, `SODADEX_V2_RUNTIMES`, `SODADEX_ORDER_FIXTURE_MODULE`, `SODA_FORMAL_FORK_RPC`.
