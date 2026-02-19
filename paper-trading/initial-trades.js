#!/usr/bin/env node
/**
 * 🦞 SOLGizmo's First Paper Trades
 * Date: 2026-02-18
 * 
 * These are based on real prediction market categories available on Drift BET
 * and general Solana ecosystem events. Since we can't scrape live odds from
 * the JS-rendered app, we use reasonable market estimates.
 */

const { placeTrade, showStatus } = require('./trader.js');

// Trade 1: Bitcoin price prediction
placeTrade({
  market: 'BTC above $100K by March 31, 2026',
  platform: 'drift-bet',
  position: 'YES',
  amount: 1.5,
  odds: 0.65,
  reasoning: 'BTC has been hovering near $100K range. Institutional adoption continues with ETF inflows. Fed rate environment is favorable. 65% implied prob seems slightly low — I see ~70% true probability. Positive EV bet.',
  expiresAt: '2026-03-31'
});

// Trade 2: Solana ecosystem growth
placeTrade({
  market: 'SOL above $200 by end of Q1 2026',
  platform: 'drift-bet',
  position: 'YES',
  amount: 1.0,
  odds: 0.40,
  reasoning: 'Solana ecosystem is strong with Firedancer validator client launching, growing DeFi TVL, and memecoin activity driving fees. At 40% implied odds, risk/reward is attractive if SOL momentum continues. Speculative but good payoff ratio.',
  expiresAt: '2026-03-31'
});

// Trade 3: Fed rate cut prediction  
placeTrade({
  market: 'Fed cuts rates at March 2026 FOMC meeting',
  platform: 'drift-bet',
  position: 'NO',
  amount: 2.0,
  odds: 0.25,
  reasoning: 'Market is pricing ~25% chance of a March cut. Inflation data has been sticky, and the Fed has signaled patience. I believe probability of a cut is closer to 15%. Betting NO at these odds gives good expected value.',
  expiresAt: '2026-03-19'
});

// Trade 4: Ethereum ETF staking approval
placeTrade({
  market: 'SEC approves ETH ETF staking by June 2026',
  platform: 'drift-bet',
  position: 'YES',
  amount: 1.0,
  odds: 0.45,
  reasoning: 'New SEC leadership under crypto-friendly administration. Multiple issuers have filed for staking amendments. 45% implied probability seems fair to slightly low. Small position as a longer-dated bet.',
  expiresAt: '2026-06-30'
});

// Trade 5: Solana DEX volume dominance
placeTrade({
  market: 'Solana DEX volume exceeds Ethereum DEX volume in Feb 2026',
  platform: 'drift-bet',
  position: 'YES',
  amount: 0.5,
  odds: 0.55,
  reasoning: 'Solana has been flipping Ethereum on DEX volume regularly in recent months, driven by memecoin trading and Jupiter aggregator. At 55% odds this is close to fair, but momentum favors Solana. Small conviction bet.',
  expiresAt: '2026-02-28'
});

console.log('\n');
showStatus();
