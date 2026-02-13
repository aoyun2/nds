#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/desmume/wasm-port"
mkdir -p "$OUT_DIR"

BASE_URL="https://ds.44670.org"

echo "Downloading desmume-wasm runtime from $BASE_URL ..."
curl -fL "$BASE_URL/nds.js" -o "$OUT_DIR/nds.js"
curl -fL "$BASE_URL/nds.wasm" -o "$OUT_DIR/nds.wasm"

echo "Saved:"
ls -lh "$OUT_DIR/nds.js" "$OUT_DIR/nds.wasm"
