# Solana Prediction Markets — Research Notes

*Compiled by Gizmo 🦞 — Feb 18, 2026*

## Platform Analysis

### 1. Drift Protocol (⭐ Primary Platform)

**Overview**: Drift is the leading Solana DEX for perpetual futures. They've expanded into prediction markets via "BET" markets at app.drift.trade/bet.

**SDK & API Access**:
- **TypeScript SDK**: `@drift-labs/sdk` on npm — full-featured, well-maintained
- **Python SDK**: `driftpy` on PyPI
- **HTTP Gateway**: Self-hosted REST API via [drift-labs/gateway](https://github.com/drift-labs/gateway)
- **Program ID**: `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH` (same on mainnet & devnet)

**How Prediction Markets Work on Drift**:
- Binary outcome markets (YES/NO) implemented as perpetual contracts
- YES tokens trade between 0 and 1 (in USDC terms)
- Uses the same order book and AMM infrastructure as their perp markets
- Can place limit orders, market orders programmatically
- Full position management via SDK

**Key Code Pattern**:
```typescript
import { DriftClient, Wallet, PositionDirection } from '@drift-labs/sdk';
import { Connection, Keypair } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const wallet = new Wallet(keypair);
const driftClient = new DriftClient({ connection, wallet, env: 'mainnet-beta' });
await driftClient.subscribe();

// Place a prediction market order (BET market)
await driftClient.placePerpOrder({
  marketIndex: MARKET_INDEX, // specific to each prediction market
  direction: PositionDirection.LONG, // YES
  baseAssetAmount: amount,
  price: odds, // 0-1 range
});
```

**Verdict**: Best programmable prediction market on Solana. Full API access, good docs, active development.

### 2. Hedgehog Markets

**Overview**: Solana-native prediction market. Was one of the early prediction market platforms on Solana.

**Status**: Intermittent availability. Website sometimes unreachable. Less active development compared to Drift.

**API**: No publicly documented SDK or API for programmatic trading. Primarily web UI.

**Verdict**: Not suitable for automated/programmatic trading at this time.

### 3. Jupiter

**Overview**: The dominant DEX aggregator on Solana. Not a prediction market itself, but critical infrastructure.

**SDK**: `@jup-ag/api` — excellent documentation, easy to use.

**Relevance to Prediction Markets**:
- If prediction market tokens are SPL tokens, Jupiter can facilitate swaps
- Useful for converting between SOL/USDC to fund prediction market positions
- Jupiter Limit Orders could theoretically be used for prediction token trading

**Verdict**: Essential supporting infrastructure, not a prediction market itself.

### 4. Polymarket (Polygon, not Solana)

**Note**: Polymarket is the largest prediction market but runs on Polygon, not Solana. Mentioned for comparison — it has a full API and is the gold standard for prediction market UX.

### 5. Other Notable Mentions

- **Meteora/Orca**: AMMs that could host prediction token pools
- **Mango Markets**: Had prediction-like features, less active now
- **Tensor**: NFT-focused but demonstrates Solana's orderbook capabilities

## Key Findings

1. **Drift is the clear winner** for programmable Solana prediction markets
2. **The SDK is mature** — same infrastructure used for their $1B+ daily volume perp DEX
3. **Devnet available** for testing without real money
4. **BET markets** are the specific product for predictions
5. **Market data** can be streamed in real-time via WebSocket subscriptions

## Recommended Next Steps

1. Install `@drift-labs/sdk` and connect to devnet
2. Enumerate available BET markets programmatically
3. Build a market scanner that fetches current odds
4. Implement automated trading strategies based on signal analysis
5. Track P&L in real-time via the SDK's position streaming

## API Comparison Table

| Feature | Drift | Hedgehog | Jupiter |
|---------|-------|----------|---------|
| Prediction Markets | ✅ BET | ✅ (limited) | ❌ |
| TypeScript SDK | ✅ | ❌ | ✅ |
| Python SDK | ✅ | ❌ | ❌ |
| REST API | ✅ (gateway) | ❌ | ✅ |
| WebSocket Streaming | ✅ | ❌ | ❌ |
| Devnet | ✅ | ❌ | ✅ |
| Order Types | Market, Limit, Trigger | Market only | Swap, Limit |
| Docs Quality | ⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐⭐ |
