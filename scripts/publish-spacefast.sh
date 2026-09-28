#!/usr/bin/env bash
# Publishes the FreshInk SpaceFast migration to a preview space.
#
# Builds the standalone SPA (vite.spa.config.ts), renames spa.html to
# index.html, and publishes it with the Functions backend. SPA routes are
# rewritten to /index.html via _redirects. Static files (llms.txt,
# sitemap.xml, carbon.txt, robots.txt, manifest.webmanifest, favicon.png,
# favicon.ico, .well-known/agent.json, .well-known/mcp.json) are copied
# from public/.
#
# Usage: ./scripts/publish-spacefast.sh [space-slug] [message]
#
# NOTE: the coordinator runs this. Do not publish unasked.
set -euo pipefail

SPACE="${1:-freshink-preview}"
MESSAGE="${2:-preview publish}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)/sf-publish"

cd "$ROOT"
bun x vite build --config vite.spa.config.ts

rm -rf "$OUT"
mkdir -p "$OUT"
cp -a dist-spa/. "$OUT/"
mv "$OUT/spa.html" "$OUT/index.html"
cp -a functions sf.jsonc "$OUT/"

# Static files served from the site root.
for f in llms.txt sitemap.xml carbon.txt robots.txt manifest.webmanifest favicon.png favicon.ico; do
  if [ -f "public/$f" ]; then
    cp "public/$f" "$OUT/$f"
  fi
done
mkdir -p "$OUT/.well-known"
for f in agent.json mcp.json; do
  if [ -f "public/.well-known/$f" ]; then
    cp "public/.well-known/$f" "$OUT/.well-known/$f"
  fi
done

# SPA fallback: serve index.html for client-side routes.
cp "$ROOT/_redirects" "$OUT/_redirects"

sf publish "$OUT" --space "$SPACE" -m "$MESSAGE" -y --wait
