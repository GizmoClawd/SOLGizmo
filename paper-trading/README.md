# 🦞 SOLGizmo Paper Trading System

A paper trading system for Solana prediction markets. **No real money involved.**

## Overview

This system simulates betting on Solana-based prediction markets using fake SOL. It tracks all trades, calculates P&L, and stores everything in JSON for analysis.

## How It Works

- Starting balance: **10 SOL** (simulated)
- Trades are logged in `trades.json`
- Portfolio state in `portfolio.json`
- Run `node trader.js` to view current status or add trades programmatically

## Supported Platforms (Research)

### 1. Drift Protocol (Primary Focus)
- **What**: On-chain perpetuals DEX with prediction market features (BET markets)
- **SDK**: `@drift-labs/sdk` (TypeScript), `driftpy` (Python)
- **API**: Full programmatic access via SDK + self-hosted HTTP gateway
- **Prediction Markets**: Available at app.drift.trade/bet — binary outcome markets
- **Key**: Uses perp market infrastructure for prediction markets (YES/NO tokens trade 0-1)
- **Programmability**: ⭐⭐⭐⭐⭐ Full SDK, can place/cancel orders, stream positions

### 2. Hedgehog Markets
- **What**: Solana-native prediction market platform
- **Status**: Was active but has had intermittent availability
- **API**: Limited public API documentation; primarily web UI
- **Programmability**: ⭐⭐ Limited — mostly web-based

### 3. Jupiter (DeFi Aggregator)
- **What**: DEX aggregator, not a prediction market per se
- **SDK**: `@jup-ag/api` — excellent for token swaps
- **Relevance**: Can be used to swap prediction market tokens if they have SPL token representations
- **Programmability**: ⭐⭐⭐⭐⭐ Best swap API on Solana

### 4. Meteora / Orca (AMM)
- **What**: AMMs that could host prediction market token pools
- **Relevance**: Secondary market for prediction tokens
- **Programmability**: ⭐⭐⭐⭐ Good SDKs available

## Architecture

```
paper-trading/
├── README.md          # This file
├── trader.js          # Main trading engine
├── portfolio.json     # Current portfolio state
├── trades.json        # Trade history log
└── research.md        # Detailed research notes
```
