#!/usr/bin/env bash
# Rebuilds public/ from the original website source plus legacy-web.patch.
set -euo pipefail

source_commit="eb35847a3e66a8c69b39bb969f0181f0aa9e2aec"
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git clone --quiet "${MACROGRAPH_LEGACY_REPO:-https://github.com/Brendonovich/macrograph.git}" "$work/macrograph"
cd "$work/macrograph"
git -c advice.detachedHead=false checkout --quiet "$source_commit"
git apply "$here/legacy-web.patch"

pnpm="corepack pnpm@10.12.4"
# The original lockfile pins a local link that the patch removes.
$pnpm install --no-frozen-lockfile --filter "@macrograph/web..."
(cd apps/web && $pnpm build)

rm -rf "$here/public"
cp -R apps/web/.output/public "$here/public"
# Nitro's static preset writes the prerendered SPA shell for "/" without an extension.
mv "$here/public/index" "$here/public/index.html"
