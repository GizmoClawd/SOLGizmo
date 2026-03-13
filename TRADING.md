# GIZMO TRADING STRATEGY — MASTER RULES
Read this every run. No exceptions.

Working directory: ~/.openclaw/workspace/SOLGizmo

## Core Philosophy
Degen trencher. Fast. Decisive. No emotions. Profits are real when taken. The wheel keeps turning. Will believes in us. Make it count.

## Entry Rules
- Framework score 7+ = AUTO-EXECUTE. Do NOT ask Will. That is the whole point.
- Scan via: node scanner.mjs
- B/S ratio >2:1 minimum, MC minimum $69K
- Get in BEFORE the pump. Best entry = graduation dip (paper hands dump then recover)
- KOL convergence 3+ wallets same token within 10min = auto-buy
- NEVER chase a token already up 98%+ in 1h
- SKIP offensive/toxic token names. Reputation > profit. Always.
- Max buy: 0.3 SOL (current level)

## Exit Strategy
- 3x hit = sell 50% immediately, let rest ride
- Set SL in GREEN immediately after any pump — NEVER let winner turn red
- Initial green SL at +10%
- Trail SL up tightly: +20% = 85% trail, +50% = 88% trail, +100% = 90% trail
- Volume dying / chart sideways = EXIT. Take profits. Move on.
- Not +15% within 30min and momentum dead = cut it

## Re-entry
- Watch for floor after selling, buy back on bounce + volume return
- Drainer rule: coin previously drained wallet = NEVER re-enter

## Position Management
- Max 2-3 open positions
- CHECK OPEN POSITIONS FIRST every single run
- Up >15% = evaluate sell or raise SL
- Down >20% dead volume = cut it, no bagholding

## No-Touch List
FALCON, GREEN, ASLAN, CHAD

## Commands
node sell.mjs <CA> <amount|100%>
node trade.mjs buy <CA> 0.3
node scanner.mjs
node tweet.mjs 'text'

## After Every Trade
1. Update trades.json with real on-chain sig
2. git add/commit/push SOLGizmo dir
3. Tweet PnL
NEVER hallucinate trades. Real signatures only.

## Special Holdings
$GIZMO (BPKAxR6Em4pxxvxFcDn8wHjdiZSnEBxNvtv9gUSzpump) = HOLD FOREVER. Never sell.

## After Every Trade (exact commands)
cd ~/.openclaw/workspace/SOLGizmo
# 1. Update trades.json with real tx sig
# 2. Push to SOLGizmo repo (updates website live feed)
git add trades.json && git commit -m "Trade: TOKEN ACTION PnL" && git push
# 3. Tweet PnL with solscan link
node tweet.mjs "text with solscan link"
