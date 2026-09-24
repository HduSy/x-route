#!/bin/bash
# Re-deploy Workers without the _redirects file (build re-adds it from public/)
cd ~/DEV/AI/route/x-route/apps/web
rm -f dist/_redirects
npx wrangler deploy 2>&1 | tail -2
sleep 6
CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://x-route.app/?v=$(date +%s)" --max-time 20)
BUNDLE=$(curl -s "https://x-route.app/?v=$(date +%s)" --max-time 15 | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
echo "首页: $CODE"
echo "线上 bundle: $BUNDLE"
