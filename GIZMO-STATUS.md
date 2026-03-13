# GIZMO STATUS — Recovery Document

## Bot location
~/gizmo-trade/gizmo.mjs

## Restart command
pkill -f gizmo.mjs; sleep 2
cd ~/gizmo-trade && nohup node gizmo.mjs >> ~/.gizmo/runtime/gizmo.log 2>&1 &

## Wallet
GOOD: 53hSYdMWfDkhBsNaYg1uKMmxiVMv192fp6t3NVhnF4rz
COMPROMISED (NEVER USE): FXdMNyRo5CqfG3yRWCcNu163FpnSusdZSYecsB76GAkn

## Key files
- Log: ~/.gizmo/runtime/gizmo.log
- Positions: /tmp/gizmo-trade/positions.json
- Trades: ~/.openclaw/workspace/SOLGizmo/trades.json
- Dashboard: ~/.gizmo/runtime/dashboard.json
- KOL DNA: ~/.gizmo/runtime/kol-dna.json
- Meta tracker: ~/.gizmo/runtime/meta-tracker.json
- Dead pools: ~/.gizmo/runtime/dead-pools.json

## Supercell build complete (March 12 2026)
- Entry B/S filter, time filter (no buys midnight-8am EST)
- Hard stop rug verification
- Triple buy dedup
- Meta tracker + hot theme boost
- KOL DNA learning
- Brain scoring on every buy
- Momentum-aware runner trail
- Claude 6hr analysis to TG
- Win rate dashboard
- Buy/sell/git all working
