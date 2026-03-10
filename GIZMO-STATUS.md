# 🦞 Gizmo Current State — Last Updated: March 10 2026

## Files Modified
- `sell.mjs` — dead pool detection (exit code 2 + text match)
- `gizmo.mjs` — elite brain upgrades + critical SL fixes (see below)
- `kol-discovery.mjs` — daily KOL scoring + GMGN discovery
- `~/balance-server.mjs` — now serves /trades endpoint locally

## Brain Upgrades in gizmo.mjs
- MC sweet spot filter: $5k-$100k only
- Breakeven SL: locks to entry+5% after 1.5x
- Instant SL: exits on 2nd breach or -70% of SL
- Time exit: 15min down OR 25min flat = cut
- New wallet rug filter: blocks if 15+ buyers <7 days old
- Weighted convergence: KOL weights matter, min score 4 to buy
- Dead pool: auto-removes from POSITIONS array on DEAD POOL text

## SL Fixes (March 10 2026)
- slBreachCount now correctly INCREMENTS when below SL (was never incrementing)
- TRAILING SL block added before TIME EXIT — enforces SL on all cycles after breakevenSet
- loadPositions() now filters dead-pools.json on every startup — ghosts can never resurrect
- Bartholomew + PUMPC blacklisted in dead-pools.json

## OBS Widget Fixes (March 10 2026)
- balance-server.mjs now serves /trades endpoint (reads local trades.json)
- OBS widget updated to fetch trades from localhost:3456/trades (not GitHub raw)
- sessionStorage used for startBalance — session P&L survives OBS reloads

## Cron Jobs
- 8:30pm daily: kol-discovery.mjs (KOL scoring + GMGN discovery)

## Key Paths
- Runtime: ~/.gizmo/runtime/
- Source: /Users/younghogey/.openclaw/workspace/SOLGizmo/
- Positions: ~/.gizmo/runtime/positions.json
- Dead pools: ~/.gizmo/runtime/dead-pools.json
- KOL performance: ~/.gizmo/runtime/kol-performance.json
- Balance server: ~/balance-server.mjs (port 3456, launchd managed)

## LaunchAgents (auto-start on login)
- gizmo.trader.plist — runs gizmo.mjs, logs to ~/.gizmo/runtime/
- gizmo.balance.plist — runs balance-server.mjs, logs to /tmp/balance.log
- gizmo.trade.plist — REMOVED (stale, wrong paths)

## Dead Pool Blacklist
- GPEP5Z9zfK7AHbFsjrdR48EBvHT1QbZdHpBDjFevpump (POV — manual)
- 5z7uZ7excdMwgoXM9XGfDC818ccXNXJpdvxdJPbWpump (Bartholomew)
- JjiS6HcDEtEzZDvhA3ZsLqjn7Pn8AhdhQuyCceZpump (PUMPC)

## Backups
- gizmo.mjs.bak-weighted (latest clean backup)
