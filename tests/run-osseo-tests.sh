#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

if [ -e node_modules ]; then
  echo "refusing to replace existing node_modules" >&2
  exit 1
fi

global_root="$(npm root -g)"
pi_root="$global_root/@earendil-works/pi-coding-agent"
if [ ! -d "$pi_root" ]; then
  echo "global Pi package not found under $global_root" >&2
  exit 1
fi

cleanup() {
  rm -rf "$repo/node_modules"
}
trap cleanup EXIT INT TERM

mkdir -p node_modules/@earendil-works
ln -s "$pi_root" node_modules/@earendil-works/pi-coding-agent
ln -s "$pi_root/node_modules/@earendil-works/pi-tui" node_modules/@earendil-works/pi-tui

node --test tests/osseo-call-line.test.ts
