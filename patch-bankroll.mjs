import fs from 'fs';

const file = process.env.HOME + '/.openclaw/workspace/SOLGizmo/gizmo.mjs';
fs.copyFileSync(file, file + '.bak-bankroll');

let code = fs.readFileSync(file, 'utf8');

const old = `async function safeBuySize(walletSol, liqUsd, numKols) {
  // Circuit breaker: stop if lost 1.5 SOL today
  const dailyPnL = getDailyPnL();
  if (dailyPnL < -1.5) { log(\`🛑 CIRCUIT BREAKER: daily loss \${dailyPnL.toFixed(3)} SOL — NO MORE TRADES\`); return 0; }
  // Recovery mode: wallet under 2 SOL → max 15% per trade, cap 0.2 SOL
  if (walletSol < 2) {
    const maxBet = Math.min(walletSol * 0.25, 0.3);
    return Math.max(0, Math.min(maxBet, walletSol - 0.08));
  }
  // Normal mode: liquidity-based sizing
  const liqSize = liqUsd ? Math.floor(liqUsd * 0.05 / 82) : 0.5;
  const kolCap = numKols >= 3 ? 3 : 2;
  return Math.min(kolCap, Math.max(0.5, liqSize));
}`;

const rep = `async function safeBuySize(walletSol, liqUsd, numKols) {
  // ── BANKROLL PROTECTION ─────────────────────────────────────────────────────
  // FLOOR: always keep 0.1 SOL untouched for gas/fees
  const FLOOR = 0.1;
  // RESERVE: keep 30% of wallet as safe reserve, never trade it
  const RESERVE = walletSol * 0.30;
  // TRADEABLE: only risk from the tradeable portion
  const tradeable = walletSol - FLOOR - RESERVE;
  if (tradeable <= 0) { log(\`🛑 BANKROLL: wallet too low (\${walletSol.toFixed(3)} SOL) — protecting floor\`); return 0; }

  // Circuit breaker: stop if lost 1.5 SOL today
  const dailyPnL = getDailyPnL();
  if (dailyPnL < -1.5) { log(\`🛑 CIRCUIT BREAKER: daily loss \${dailyPnL.toFixed(3)} SOL — NO MORE TRADES\`); return 0; }

  // TIER SYSTEM based on wallet size:
  let maxPerTrade, pctPerTrade;

  if (walletSol >= 5) {
    // Healthy: max 15% of tradeable per trade, hard cap 1.0 SOL
    pctPerTrade = 0.15;
    maxPerTrade = 1.0;
  } else if (walletSol >= 2) {
    // Cautious: max 12% of tradeable, hard cap 0.5 SOL
    pctPerTrade = 0.12;
    maxPerTrade = 0.5;
  } else if (walletSol >= 0.5) {
    // Recovery mode: max 10% of tradeable, hard cap 0.2 SOL
    pctPerTrade = 0.10;
    maxPerTrade = 0.2;
  } else {
    // Survival mode: max 8% of tradeable, hard cap 0.08 SOL
    pctPerTrade = 0.08;
    maxPerTrade = 0.08;
  }

  const baseSize = Math.min(tradeable * pctPerTrade, maxPerTrade);

  // Boost slightly for high conviction (3+ KOLs) but never exceed 2x base
  const convictionMult = numKols >= 3 ? 1.5 : numKols >= 2 ? 1.2 : 1.0;
  const size = Math.min(baseSize * convictionMult, maxPerTrade * 1.5);

  log(\`💰 BANKROLL: wallet \${walletSol.toFixed(3)} SOL | tradeable \${tradeable.toFixed(3)} | sizing \${size.toFixed(3)} SOL (\${(size/walletSol*100).toFixed(0)}% of wallet)\`);
  return Math.max(0, parseFloat(size.toFixed(4)));
  // ───────────────────────────────────────────────────────────────────────────
}`;

if (!code.includes(old)) {
  console.error('❌ Could not find safeBuySize function');
  process.exit(1);
}

code = code.replace(old, rep);
fs.writeFileSync(file, code);
console.log('✅ Backed up to gizmo.mjs.bak-bankroll');
console.log('✅ Bankroll protection installed!');
console.log('');
console.log('   Tier system:');
console.log('   • 5+ SOL  → max 15% per trade, hard cap 1.0 SOL');
console.log('   • 2-5 SOL → max 12% per trade, hard cap 0.5 SOL');
console.log('   • 0.5-2   → max 10% per trade, hard cap 0.2 SOL');
console.log('   • <0.5    → survival mode, max 0.08 SOL per trade');
console.log('   • Always keeps 30% reserve + 0.1 SOL floor untouched');
