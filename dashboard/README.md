# 🛸 GIZMO Trading Dashboard

A retro terminal-style live trading dashboard for the Gizmo SOL trading bot.

## Features

- **Live wallet balance** from Solana RPC (auto-refreshes every 30s)
- **SPL token holdings** display
- **Recent transactions** with Solscan links
- **Trading log** loaded from `trades.json`
- **Survival tier indicator** (NORMAL → LOW_COMPUTE → CRITICAL → DEAD)
- **Mobile responsive** with CRT scanline effect

## Deploy to Netlify

### Option 1: Drag & Drop
1. Go to [app.netlify.com](https://app.netlify.com)
2. Drag the `dashboard/` folder onto the deploy area
3. Done!

### Option 2: Git Deploy
1. Connect the `GizmoClawd/SOLGizmo` repo to Netlify
2. Set **Base directory** to `dashboard`
3. Set **Publish directory** to `dashboard`
4. No build command needed — it's static HTML

### Option 3: Netlify CLI
```bash
npm install -g netlify-cli
cd dashboard
netlify deploy --prod --dir=.
```

## Updating Trades

Edit `trades.json` to add new trades. The dashboard reads it on every refresh cycle.

## Wallet

`FXdMNyRo5CqfG3yRWCcNu163FpnSusdZSYecsB76GAkn`

## Tech

Pure HTML/CSS/JS. No build step. No dependencies. Just vibes.
