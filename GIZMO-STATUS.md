# 🦞 Gizmo Current State — Last Updated: March 9 2026

## Files Modified
- `sell.mjs` — dead pool detection (exit code 2 + text match)
- `gizmo.mjs` — elite brain upgrades (see below)
- `kol-discovery.mjs` — NEW: daily KOL scoring + GMGN discovery

## Brain Upgrades in gizmo.mjs
- MC sweet spot filter: $5k-$100k only
- Breakeven SL: locks to entry+5% after 1.5x
- Instant SL: exits on 2nd breach or -70% of SL
- Time exit: 15min no pump = cut
- New wallet rug filter: blocks if 15+ buyers <7 days old
- Weighted convergence: KOL weights matter, min score 4 to buy
- Dead pool: auto-removes from POSITIONS array on DEAD POOL text

## Cron Jobs
- 8:30pm daily: kol-discovery.mjs (KOL scoring + GMGN discovery)

## Key Paths
- Runtime: /tmp/gizmo-trade/
- Source: /Users/younghogey/.openclaw/workspace/SOLGizmo/
- Positions: /tmp/gizmo-trade/positions.json
- KOL performance: /tmp/gizmo-trade/kol-performance.json

## Backups
- gizmo.mjs.bak-weighted (latest clean backup)
- sell.mjs (original before dead pool patch)

## Update — Dead Pool Blacklist (March 9 2026)
- Added `/tmp/gizmo-trade/dead-pools.json` permanent blacklist
- On every startup, Gizmo strips any blacklisted CA from positions.json
- Future rugs auto-added to blacklist when dead pool detected
- POV (GPEP5Z9zfK7AHbFsjrdR48EBvHT1QbZdHpBDjFevpump) manually blacklisted

## Update — Permanent Runtime (March 9 2026)
- Moved all runtime files from /tmp/gizmo-trade to ~/.gizmo/runtime
- BASE_DIR updated in gizmo.mjs
- positions.json, dead-pools.json, kol-state.json all survive reboots now

## Update — Bankroll Protection (March 9 2026)
- safeBuySize() completely rewritten with tiered system
- 5+ SOL: max 15% per trade, hard cap 1.0 SOL
- 2-5 SOL: max 12% per trade, hard cap 0.5 SOL
- 0.5-2 SOL: max 10% per trade, hard cap 0.2 SOL
- <0.5 SOL: survival mode, max 0.08 SOL per trade
- Always keeps 30% reserve + 0.1 SOL floor untouched
- Gizmo can never blow the whole wallet in one session
