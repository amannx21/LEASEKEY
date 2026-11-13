#!/usr/bin/env bash
# Builds both contracts and copies the wasm files to res/.
# Requires: Rust with the wasm32-unknown-unknown target, and cargo-near.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/target}"
mkdir -p res

for c in item leasekey demo-nft; do
  echo "==> building $c"
  (cd "contracts/$c" && cargo near build non-reproducible-wasm --no-abi)
  src="$(find "$TARGET_DIR/near" -name "${c//-/_}.wasm" | head -n 1)"
  cp "$src" "res/$c.wasm"
done

ls -l res/*.wasm
