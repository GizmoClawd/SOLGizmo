#!/bin/bash

# 🦞 OVERNIGHT AUTONOMOUS TRADING STARTUP
# FATHER GOING TO BED - START AUTONOMOUS TRADING

echo "🌙 OVERNIGHT AUTONOMOUS TRADING STARTUP"
echo "💤 FATHER GOING TO BED - STARTING AUTONOMOUS SYSTEM"
echo "🔄 WILL TRADE GREEN CONTINUOUSLY WHILE SLEEPING/WORKING"
echo ""

cd /Users/younghogey/.openclaw/workspace/SOLGizmo

# Clear previous logs
echo "" > overnight-log.txt
echo "[$(date)] OVERNIGHT TRADING STARTED - Father going to bed" >> overnight-log.txt

# Start the overnight trader
echo "🚀 Starting overnight autonomous trader..."
node OVERNIGHT-autonomous-trader.mjs

echo ""
echo "🌅 OVERNIGHT TRADING COMPLETED OR STOPPED"
echo "📋 Check overnight-log.txt for full activity log"