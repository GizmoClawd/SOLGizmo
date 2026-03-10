# 🦞 Gizmo Current State — Last Updated: March 10 2026

## Brain Upgrades (March 10 2026)
- TP LADDER: 25% at 1.5x → 25% at 2x → 50% moonbag to 5x+
- DCA at floor: 60% entry, adds 40% only on dip back to entry zone
- DCA timeout: skips add if no dip after 5 cycles (no top blasting)
- slBreachCount now increments correctly when below SL
- TRAILING SL block enforces SL every cycle after breakevenSet
- loadPositions() filters dead-pools.json on every startup
- buy() blocks blacklisted CAs from being re-entered
- Bartholomew + PUMPC blacklisted in dead-pools.json

## OBS Widget (March 10 2026)
- balance-server.mjs serves /trades endpoint locally
- Widget fetches trades from localhost:3456/trades
- sessionStorage persists session P&L across OBS reloads

## Entry Logic
- 9-signal scorer (same as solgizmo.com CA analyzer)
- Min score 4 to buy (3 if elite KOL convergence score 9+)
- MC sweet spot: $5k-$100k
- Rug wallet check: blocks if 15+ buyers <7 days old
- KOL convergence: min 2 KOLs, weighted scoring

## Exit Logic
- TP1: 25% at 1.5x, SL to breakeven
- TP2: 25% at 2x, tight trailing SL on moonbag
- TP3: 100% at 5x (moonbag)
- Fast pump: 50% if +30% fading momentum
- Trailing SL: enforced every cycle after breakevenSet
- Hard stop: -30% with no SL set, -50% hard floor
- Time exit: 15min down OR 25min flat = cut

## Bankroll Tiers
- 5+ SOL: 15% per trade, 1.0 SOL cap
- 2-5 SOL: 12% per trade, 0.5 SOL cap
- 0.5-2 SOL: 10% per trade, 0.2 SOL cap
- <0.5 SOL: survival mode, 0.08 SOL cap
- 30% reserve + 0.1 SOL floor always untouched
- Circuit breaker: stops if -1.5 SOL in a day

## LaunchAgents (auto-start on login)
- gizmo.trader.plist — gizmo.mjs, logs to ~/.gizmo/runtime/
- gizmo.balance.plist — balance-server.mjs, port 3456

## Key Paths
- Runtime: ~/.gizmo/runtime/
- Source: /Users/younghogey/.openclaw/workspace/SOLGizmo/
- Positions: ~/.gizmo/runtime/positions.json
- Dead pools: ~/.gizmo/runtime/dead-pools.json

## Dead Pool Blacklist
- GPEP5Z9zfK7AHbFsjrdR48EBvHT1QbZdHpBDjFevpump (POV)
- 5z7uZ7excdMwgoXM9XGfDC818ccXNXJpdvxdJPbWpump (Bartholomew)
- JjiS6HcDEtEzZDvhA3ZsLqjn7Pn8AhdhQuyCceZpump (PUMPC)
