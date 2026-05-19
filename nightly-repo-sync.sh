#!/bin/zsh
# Nightly repo sync for SOLGizmo ecosystem
# Syncs trading data, website, and pushes live updates

set -e

WORKSPACE=~/.openclaw/workspace
SOLGIZMO_DIR="$WORKSPACE/SOLGizmo"
WEBSITE_DIR="$WORKSPACE/solgizmo-website"

echo "🌙 Starting nightly repo sync — $(date)"

# 1. Sync SOLGizmo repo (trades.json + code)
cd "$SOLGIZMO_DIR"
echo "→ Pulling latest in SOLGizmo..."
git pull --rebase || true
git add -A
if git diff --cached --quiet; then
  echo "   No changes in SOLGizmo"
else
  git commit -m "nightly sync: $(date +%Y-%m-%d)"
  git push
  echo "   ✓ Pushed SOLGizmo updates"
fi

# 2. Sync solgizmo-website (live trading feed)
cd "$WEBSITE_DIR"
echo "→ Pulling latest in solgizmo-website..."
git pull --rebase || true
git add -A
if git diff --cached --quiet; then
  echo "   No changes in solgizmo-website"
else
  git commit -m "nightly sync: $(date +%Y-%m-%d)"
  git push
  echo "   ✓ Pushed website updates (Netlify will deploy)"
fi

echo "✅ Nightly repo sync complete — all repos in sync"
