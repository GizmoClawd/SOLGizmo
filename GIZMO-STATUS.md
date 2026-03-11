# 🦞 GIZMO STATUS — March 10/11 2026

## Wallet
- **Balance:** ~1.7 SOL (recovering)
- **Session:** started 1.875, dipped to 1.47 from bugs, recovered to 1.7+
- **Tier:** 0.5–2 SOL → 7-8% sizing per trade

---

## Infrastructure
| Component | Status |
|-----------|--------|
| gizmo.mjs | ✅ Running via launchd (gizmo.trader.plist) |
| balance-server.mjs | ✅ Running via launchd (gizmo.balance.plist) port 3456 |
| OBS Widget | ✅ Served via http://localhost:3456/overlay (NOT local file) |
| solgizmo.com trades feed | ✅ Auto-push via trades.json → GitHub |
| kol-discovery cron | ✅ 8:30pm nightly /opt/homebrew/bin/node (FIXED path) |

### Key Paths
- Runtime: ~/.gizmo/runtime/
- Source: /Users/younghogey/.openclaw/workspace/SOLGizmo/
- Positions: ~/.gizmo/runtime/positions.json
- KOL weights: ~/.gizmo/runtime/kol-performance.json
- Dead pools: ~/.gizmo/runtime/dead-pools.json
- Alerted (persisted): ~/.gizmo/runtime/alerted.json
- Trades: trades.json (auto-pushed to GitHub)
- Logs: ~/.gizmo/runtime/gizmo.log

---

## All Bugs Fixed This Session

### Balance Reading (ROOT CAUSE OF MOST LOSSES TONIGHT)
- ✅ getWalletBalance() now uses Helius RPC
- Was using publicnode returning 0.271 instead of real 1.47 SOL
- This caused all circuit breakers to fire wrong, decu to slip through on tiny sizes

### Stop-Loss System
- ✅ Trailing SL fires on ALL positions with SL set (not just post-breakeven)
- ✅ slBreachCount increments correctly

### Ghost Positions
- ✅ loadPositions() filters dead-pools on startup
- ✅ buy() checks dead pools before executing

### KOL Discovery
- ✅ Reads real % PnL from result field (not SOL returned)
- ✅ Deduplication — stops re-counting trades every run
- ✅ Never overwrites live weights in gizmo.mjs
- ✅ Duplicate cron removed

### MUTED KOL Bypass
- ✅ MUTED KOLs blocked in HIGH-WEIGHT buy path
- ✅ livePerf scope error fixed (was causing loop errors)

### KOL Weight Corruption
- ✅ kol-performance.json reset to real values
- ✅ Deduplication in learnFromTrades

### OBS Widget
- ✅ Served via HTTP not local file
- ✅ Session P&L working

---

## Intelligence Upgrades

### Tiered KOL Polling (saves Helius credits)
- GOD/ELITE: every cycle
- SOLID: every 3rd cycle  
- WATCH: every 5th cycle
- MUTED: never polled
- Result: ~300k credits/day (was 1M) — lasts to March 25

### Dynamic Min Trade Size
- < 2 SOL: min 0.09 SOL
- 2+ SOL: min 0.30 SOL
- 5+ SOL: min 0.50 SOL

### Moonbag Trailing SL (LOOSENED)
- Default: 80% of high (was 90%)
- Post-TP2 moonbag: 65% of high (was 88%)
- 3x+: 85%, 5x+: 90%

### Require Weight >= 3 for Single KOL Buys
- Solo weight-2 KOLs can no longer trigger buys alone

### Persist ALERTED to Disk
- ~/.gizmo/runtime/alerted.json survives restarts
- Stops re-buying rugged coins after restart

---

## KOL Performance (real data)
| KOL | Tier | Weight |
|-----|------|--------|
| radiance | GOD | 4 |
| bandit | ELITE | 3 |
| dv | ELITE | 3 |
| Jijo | SOLID | 2 |
| theo | SOLID | 2 |
| clukz | SOLID | 2 |
| Silver | WATCH | 1 |
| Cented | WATCH | 1 |
| Pain | MUTED | 0 |
| decu | MUTED | 0 |
| dov7 | MUTED | 0 |
| Joji | MUTED | 0 |

---

## TODO — Next Session (in priority order)
1. Wire 9-point framework into gizmo.mjs market scanner (currently only on website)
2. Runner DNA profiler — catalog 5x+ entry characteristics
3. Token age filter — reject tokens under 5 minutes old
4. Meta detector — track narrative keywords hitting 3x+ in last 48h
5. Whale dump exit — sell if top 10 holders exit % spikes
6. learnFromTrades() fix — reads pnl SOL field not % yet
7. Push full GIZMO-STATUS.md to GitHub

## Helius Credits
- Remaining: ~5.5M
- Daily burn after fix: ~300k/day
- Runway: March 25 ✅
