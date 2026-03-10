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
