#!/bin/bash

# 🚨 EMERGENCY LOCAL SOLANA RPC SETUP - ZERO API COSTS

echo "🚨 Setting up local Solana RPC node..."
echo "💿 Available disk space: $(df -h / | tail -1 | awk '{print $4}')"

# Create directory for Solana data
mkdir -p ~/.solana-rpc
cd ~/.solana-rpc

# Set Solana config to mainnet
solana config set --url https://api.mainnet-beta.solana.com

echo "📡 Starting local RPC node (this will sync with mainnet)..."
echo "⚠️  Initial sync may take 1-2 hours"
echo "🎯 Once synced: localhost:8899 = ZERO API costs"

# Start RPC node with minimal storage requirements
nohup solana-validator \
  --identity ~/.solana-rpc/validator-keypair.json \
  --vote-account ~/.solana-rpc/vote-account-keypair.json \
  --ledger ~/.solana-rpc/ledger \
  --log ~/.solana-rpc/validator.log \
  --rpc-port 8899 \
  --only-known-rpc \
  --no-voting \
  --no-snapshot-fetch \
  --no-genesis-fetch \
  --accounts-shrink-optimize-total-space \
  --accounts-shrink-ratio 0.8 \
  --limit-ledger-size 50000000 \
  > ~/.solana-rpc/startup.log 2>&1 &

echo "🚀 Local RPC starting in background..."
echo "📊 Monitor with: tail -f ~/.solana-rpc/validator.log"
echo "🔗 Test with: curl -X POST -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getHealth\"}' http://localhost:8899"

echo ""
echo "✅ Once synced, update all scripts to use: http://localhost:8899"
echo "💸 Result: ZERO API costs forever"