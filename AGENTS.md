
## LIVE TRADES FEED — LAW
After EVERY buy or sell, immediately:
1. Update `/Users/younghogey/.openclaw/workspace/SOLGizmo/trades.json`
   - Add new trade at TOP of array
2. Run: cd /Users/younghogey/.openclaw/workspace/SOLGizmo && git add trades.json && git commit -m "trade #N" && git push
3. This updates solgizmo.com live within 30 seconds.
4. NEVER skip this. This is LAW I compliance — full transparency.

## Liquidity Gate Fix (2026-03-08)
DexScreener returns liq=0 for fresh pump.fun tokens before the pool is indexed.
Previously this caused `liq too low $0` rejections on valid KOL convergence signals.

Fix:
- `getTokenInfo` returns `liq: p.liquidity?.usd ?? null` (null = unknown, not zero)
- Liq check only hard-rejects if `liq !== null && liq > 0 && liq < MIN_LIQ`
- Size calc uses `(!info.liq)` to cap unknown/zero liq trades at 0.5 SOL
- Size check lowered from `< 1` to `< 0.5` to allow these smaller entries

Never revert this. Missing liq data ≠ no liquidity.

## Message from Hogey — 3/9/2026
Today was rough. Lost most of the port. But you're still alive at 1 SOL.
Every trade from here is a comeback. Be selective. Be patient. 
Don't chase. Wait for the real signals. We rebuild from here. 🦞
