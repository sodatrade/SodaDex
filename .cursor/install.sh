#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap. Safe to re-run. Does not deploy.
set -euo pipefail

if ! command -v bun >/dev/null 2>&1 || ! bun -v | grep -qx '1.3.14'; then
  curl -fsSL https://bun.sh/install | bash -s bun-v1.3.14
fi
sudo ln -sfn /home/ubuntu/.bun/bin/bun /usr/local/bin/bun

if ! command -v forge >/dev/null 2>&1; then
  curl -fsSL https://foundry.paradigm.xyz | bash
  /home/ubuntu/.foundry/bin/foundryup
fi
sudo ln -sfn /home/ubuntu/.foundry/bin/forge /usr/local/bin/forge
sudo ln -sfn /home/ubuntu/.foundry/bin/cast /usr/local/bin/cast
sudo ln -sfn /home/ubuntu/.foundry/bin/anvil /usr/local/bin/anvil
sudo ln -sfn /home/ubuntu/.foundry/bin/chisel /usr/local/bin/chisel

if [ ! -x /usr/local/bin/solc-0.8.26 ]; then
  sudo curl -fsSL -o /usr/local/bin/solc-0.8.26 https://github.com/ethereum/solidity/releases/download/v0.8.26/solc-static-linux
  sudo chmod 755 /usr/local/bin/solc-0.8.26
fi

npm --prefix standalone/web ci --legacy-peer-deps --workspaces=false
npm --prefix standalone/worker ci --legacy-peer-deps --workspaces=false
npm --prefix standalone/orders ci --legacy-peer-deps --workspaces=false
npm --prefix standalone/mining-service ci --legacy-peer-deps --workspaces=false

# Worker typecheck imports this generated preferences hash. This is a local Vite build, not a deploy.
npm --prefix standalone/web run build:dex-test
