#!/bin/bash
# 🦞 Gizmo Backup & Health Check Script
# Usage: bash backup.sh [verify|backup|restore]

BACKUP_DIR="$HOME/.gizmo/backups/$(date +%Y-%m-%d_%H%M%S)"
WORKSPACE="$HOME/.openclaw/workspace"
TRADE_DIR="/tmp/gizmo-trade"
CHECKS_PASSED=0
CHECKS_FAILED=0

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

check() {
  if [ "$2" = "true" ]; then
    echo -e "  ${GREEN}✅${NC} $1"
    ((CHECKS_PASSED++))
  else
    echo -e "  ${RED}❌${NC} $1"
    ((CHECKS_FAILED++))
  fi
}

verify() {
  echo "🦞 GIZMO HEALTH CHECK"
  echo "====================="
  
  echo ""
  echo "📁 Critical Files:"
  check "Wallet key" "$([ -f $HOME/.gizmo/solana-wallet.json ] && echo true || echo false)"
  check "SOUL.md" "$([ -f $WORKSPACE/SOUL.md ] && echo true || echo false)"
  check "MEMORY.md" "$([ -f $WORKSPACE/MEMORY.md ] && echo true || echo false)"
  check "IDENTITY.md" "$([ -f $WORKSPACE/IDENTITY.md ] && echo true || echo false)"
  check "USER.md" "$([ -f $WORKSPACE/USER.md ] && echo true || echo false)"
  check "AGENTS.md" "$([ -f $WORKSPACE/AGENTS.md ] && echo true || echo false)"
  check "HEARTBEAT.md" "$([ -f $WORKSPACE/HEARTBEAT.md ] && echo true || echo false)"
  check "SESSION-STATE.md" "$([ -f $WORKSPACE/SESSION-STATE.md ] && echo true || echo false)"
  check "TOOLS.md" "$([ -f $WORKSPACE/TOOLS.md ] && echo true || echo false)"
  
  echo ""
  echo "🔧 Trading Scripts:"
  check "trade.mjs" "$([ -f $TRADE_DIR/trade.mjs ] && echo true || echo false)"
  check "sell.mjs" "$([ -f $TRADE_DIR/sell.mjs ] && echo true || echo false)"
  check "auto-manage.mjs" "$([ -f $TRADE_DIR/auto-manage.mjs ] && echo true || echo false)"
  check "autonomous.mjs" "$([ -f $TRADE_DIR/autonomous.mjs ] && echo true || echo false)"
  check "kol-tracker.mjs" "$([ -f $TRADE_DIR/kol-tracker.mjs ] && echo true || echo false)"
  check "tweet.mjs" "$([ -f $TRADE_DIR/tweet.mjs ] && echo true || echo false)"
  
  echo ""
  echo "🔄 Running Processes:"
  check "auto-manage.mjs running" "$(pgrep -f 'node auto-manage.mjs' > /dev/null && echo true || echo false)"
  check "autonomous.mjs running" "$(pgrep -f 'node autonomous.mjs' > /dev/null && echo true || echo false)"
  check "kol-tracker.mjs running" "$(pgrep -f 'node kol-tracker.mjs' > /dev/null && echo true || echo false)"
  
  echo ""
  echo "🌐 Connectivity:"
  check "DexScreener API" "$(curl -s -o /dev/null -w '%{http_code}' 'https://api.dexscreener.com/latest/dex/search?q=SOL' | grep -q 200 && echo true || echo false)"
  check "Jupiter API" "$(curl -s -o /dev/null -w '%{http_code}' 'https://lite-api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000' | grep -q 200 && echo true || echo false)"
  check "Solana RPC (public)" "$(curl -s -o /dev/null -w '%{http_code}' -X POST 'https://api.mainnet-beta.solana.com' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q 200 && echo true || echo false)"
  
  echo ""
  echo "📊 OpenClaw:"
  check "openclaw config" "$([ -f $HOME/.openclaw/openclaw.json ] && echo true || echo false)"
  check "openclaw gateway" "$(pgrep -f 'openclaw' > /dev/null && echo true || echo false)"
  
  echo ""
  echo "========================"
  echo -e "Results: ${GREEN}${CHECKS_PASSED} passed${NC} / ${RED}${CHECKS_FAILED} failed${NC} / $((CHECKS_PASSED + CHECKS_FAILED)) total"
}

backup() {
  echo "🦞 BACKING UP..."
  mkdir -p "$BACKUP_DIR"
  
  # Wallet
  cp -r $HOME/.gizmo "$BACKUP_DIR/dot-gizmo"
  
  # Workspace
  cp -r $WORKSPACE "$BACKUP_DIR/workspace"
  
  # Trading scripts
  mkdir -p "$BACKUP_DIR/gizmo-trade"
  cp $TRADE_DIR/*.mjs "$BACKUP_DIR/gizmo-trade/" 2>/dev/null
  cp $TRADE_DIR/*.json "$BACKUP_DIR/gizmo-trade/" 2>/dev/null
  
  # OpenClaw config
  cp $HOME/.openclaw/openclaw.json "$BACKUP_DIR/" 2>/dev/null
  
  echo "✅ Backup saved to: $BACKUP_DIR"
  echo "📦 Size: $(du -sh "$BACKUP_DIR" | awk '{print $1}')"
  
  # Verify backup
  echo ""
  echo "Verifying backup..."
  check "Wallet in backup" "$([ -f $BACKUP_DIR/dot-gizmo/solana-wallet.json ] && echo true || echo false)"
  check "SOUL.md in backup" "$([ -f $BACKUP_DIR/workspace/SOUL.md ] && echo true || echo false)"
  check "MEMORY.md in backup" "$([ -f $BACKUP_DIR/workspace/MEMORY.md ] && echo true || echo false)"
  check "Scripts in backup" "$([ -f $BACKUP_DIR/gizmo-trade/auto-manage.mjs ] && echo true || echo false)"
}

case "${1:-verify}" in
  verify) verify ;;
  backup) backup ;;
  *) echo "Usage: bash backup.sh [verify|backup]" ;;
esac
