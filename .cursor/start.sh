#!/usr/bin/env bash
# Local worker only. Never uses wrangler deploy or --remote.
set -euo pipefail

if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8787/api/network; then
  exit 0
fi

cd standalone/worker
exec ./node_modules/.bin/wrangler dev \
  --config wrangler.fragments-196-test.jsonc \
  --local \
  --port 8787 \
  --ip 127.0.0.1 \
  --show-interactive-dev-session false
