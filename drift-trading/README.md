# 🦞 Gizmo's Drift BET Bot

A Solana prediction market trading bot using Drift Protocol's BET markets.

## Setup

```bash
npm install
```

Set RPC (optional, defaults to public mainnet):
```bash
export SOLANA_RPC_URL="https://your-rpc-endpoint.com"
```

Wallet: `~/.gizmo/solana-wallet.json`

## Usage

```bash
# List all BET prediction markets with current odds
npx ts-node src/drift-bet-bot.ts markets

# Check your open positions and P&L
npx ts-node src/drift-bet-bot.ts positions

# Place a bet (market order)
npx ts-node src/drift-bet-bot.ts bet <marketIndex> <YES|NO> <amountUSDC>

# Place a bet (limit order)
npx ts-node src/drift-bet-bot.ts bet <marketIndex> <YES|NO> <amountUSDC> <limitPrice>

# Show everything
npx ts-node src/drift-bet-bot.ts all
```

## Examples

```bash
# See what prediction markets are available
npx ts-node src/drift-bet-bot.ts markets

# Bet $10 on YES for market index 45
npx ts-node src/drift-bet-bot.ts bet 45 YES 10

# Bet $5 on NO with limit price 0.35
npx ts-node src/drift-bet-bot.ts bet 45 NO 5 0.35
```

## Programmatic Use

```typescript
import { DriftBetBot } from './src';

const bot = new DriftBetBot();
await bot.connect();

// Get all BET markets
const markets = bot.getBetMarkets();
console.log(markets);

// Place a bet
await bot.setupUser();
await bot.placeBet(45, 'YES', 10);

// Check positions
const positions = await bot.getPositions();

await bot.disconnect();
```

## Safety

- Max bet: $100 (configurable in code)
- No trades are placed unless you explicitly run the `bet` command
- All trading is on Solana mainnet - use real money carefully!

## Architecture

- `src/config.ts` - Wallet loading, RPC connection
- `src/drift-bet-bot.ts` - Main bot class + CLI
- `src/index.ts` - Exports for programmatic use
