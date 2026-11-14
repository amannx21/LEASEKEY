#!/usr/bin/env bash
# Deploys LeaseKey to NEAR TESTNET and seeds demo items.
# Requires Node 20+. Uses res/*.wasm (committed; rebuild with scripts/build.sh).
# Options (env): MODE=global|embedded  ITEMS=1..6  FACTORY_ID=name.testnet
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f res/item.wasm ] && [ -f res/leasekey.wasm ] || bash scripts/build.sh
[ -d node_modules ] || npm install --no-audit --no-fund
npx tsx scripts/deploy.ts "$@"
# Slime Arena, the demo game, is its own contract and registered game.
npx tsx scripts/arena-setup.ts
