#!/usr/bin/env bash
# Rebuild packages/astrid-rules/ — astrid-core's rules door as WebAssembly — at a pinned revision.
#
#   scripts/build-astrid-rules.sh                 # rebuild at the revision in REVISION
#   scripts/build-astrid-rules.sh --rev <sha>     # move the pin, then rebuild
#   scripts/build-astrid-rules.sh --core <dir>    # build from this checkout or worktree (default ../astrid-core)
#
# The same discipline as astrid-ios's core/Cargo.toml pin: the web runs exactly the revision
# recorded in packages/astrid-rules/REVISION, and moving it is a deliberate, reviewable commit
# that changes REVISION and the built files together. The build is committed (Vercel has no Rust
# toolchain), so nothing here runs during `npm run build`.
#
# What lands in packages/astrid-rules/:
#   REVISION                  the astrid-core commit the files were built from
#   node/                     wasm-bindgen's Node package: runJson(string) -> string
#   fixtures/permissions.json the contract fixture at that revision, for the parity test
#
# Server-only: no browser build is vendored (377 KB gzipped is too much to ship to every page for
# a shadow check). astrid-core's scripts/build-wasm.sh writes one when that changes.
#
# Needs: git, Rust (rustup), and the wasm-bindgen CLI version astrid-core's Cargo.lock pins —
# its build-wasm.sh says which and how to install it.
set -euo pipefail

web="$(cd "$(dirname "$0")/.." && pwd)"
pkg="$web/packages/astrid-rules"
core="$web/../astrid-core"
rev=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rev) rev="$2"; shift 2 ;;
    --core) core="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$rev" ]] || rev="$(tr -d '[:space:]' <"$pkg/REVISION")"
# `git rev-parse` rather than a test for a .git directory: in a worktree, .git is a file.
git -C "$core" rev-parse --git-dir >/dev/null 2>&1 || { echo "no astrid-core checkout at $core (pass --core)" >&2; exit 1; }
export PATH="$HOME/.cargo/bin:$PATH"

git -C "$core" fetch --quiet origin || true
rev="$(git -C "$core" rev-parse --verify "$rev^{commit}")"

# A throwaway worktree, so the build is of exactly that commit whatever the checkout has on it.
tree="$(mktemp -d)/astrid-core"
out="$(mktemp -d)"
cleanup() { git -C "$core" worktree remove --force "$tree" >/dev/null 2>&1 || true; rm -rf "$out"; }
trap cleanup EXIT
git -C "$core" worktree add --quiet --detach "$tree" "$rev"

# Reuse the checkout's target directory: a cold build of the dependency graph is most of the time.
CARGO_TARGET_DIR="$core/target" "$tree/scripts/build-wasm.sh" "$out"

rm -rf "$pkg/node" "$pkg/fixtures"
mkdir -p "$pkg/fixtures"
cp -R "$out/node" "$pkg/node"
# The glue is CommonJS; say so, so a "type": "module" anywhere above it cannot change how it loads.
printf '{ "type": "commonjs" }\n' >"$pkg/node/package.json"
cp "$tree/contracts/fixtures/permissions.json" "$pkg/fixtures/permissions.json"
printf '%s\n' "$rev" >"$pkg/REVISION"

echo "packages/astrid-rules at astrid-core $rev"
