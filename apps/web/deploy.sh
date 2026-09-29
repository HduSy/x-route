#!/bin/bash
# ⚠️  EMERGENCY-ONLY local deploy — NOT for daily shipping.
#
# Daily deployment is fully automated: every push to main triggers
# .github/workflows/deploy.yml (builds once, ships Worker + Pages, and its
# "deploy-main" concurrency group cancels superseded runs). Run this script
# ONLY when CI is broken and production needs a fix right now.
#
# What it does: build once, ship to BOTH targets.
# - Workers (x-route.app): must NOT contain _redirects (Workers Assets would 301-loop static files)
# - Pages (legacy 301):    must contain _redirects (pages.dev -> x-route.app)
#
# Race note: a local deploy can still collide with an in-flight CI run —
# when possible, trigger the pipeline remotely instead:
#   gh workflow run "Deploy to Cloudflare"   # or use the Actions tab

set -e
cd "$(dirname "$0")"

echo "ℹ️  Daily deploys go through GitHub Actions. Prefer: gh workflow run \"Deploy to Cloudflare\""
echo "    (a local deploy may collide with an in-flight CI run)"

pnpm build
# 1) Workers deploy without _redirects
rm -f dist/_redirects
npx wrangler deploy
# Pages step re-adds it; strip again so dist stays clean after the script exits
rm -f dist/_redirects
# 2) Pages deploy with _redirects
cp public/_redirects dist/_redirects
npx wrangler pages deploy dist --project-name=x-route --branch main
rm -f dist/_redirects
echo "done."
