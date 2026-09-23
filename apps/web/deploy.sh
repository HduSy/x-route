#!/bin/bash
# x-route web deploy: build once, ship to BOTH targets.
# - Workers (x-route.app): must NOT contain _redirects (Workers Assets would 301-loop static files)
# - Pages (legacy 301):    must contain _redirects (pages.dev -> x-route.app)
set -e
cd "$(dirname "$0")"
pnpm build
# 1) Workers deploy without _redirects
rm -f dist/_redirects
npx wrangler deploy
# 2) Pages deploy with _redirects
cp public/_redirects dist/_redirects
npx wrangler pages deploy dist --project-name x-route --branch main
echo "done."
