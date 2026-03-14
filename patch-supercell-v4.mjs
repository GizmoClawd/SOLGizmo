/**
 * 🦞 GIZMO SUPERCELL PATCH v4 — DATA-DRIVEN KOL FIX
 * ────────────────────────────────────────────────────
 * Run: node patch-supercell-v4.mjs
 *
 * PROBLEM: v2 protected Cented and dv based on % win rate, but actual SOL P&L shows:
 *   bandit: +1.354 SOL (10 trades) ← KING
 *   Silver: +0.482 SOL (3 trades)  ← hidden gem
 *   Jijo:   +0.331 SOL (5 trades)  ← solid
 *   Cented: -0.230 SOL (21 trades) ← HIGH VOLUME LOSER (was forced to ELITE)
 *   dv:     -0.550 SOL (15 trades) ← BIGGEST LOSER (was protected from demotion)
 *   theo:   -0.084 SOL (8 trades)  ← small bleed
 *
 * FIX: Set KOL weights based on actual SOL profitability, not win rate.
 *      Remove bad protections. Only protect proven money-makers.
 */

import fs from 'fs';

// ═══════════════════════════════════════════════════════════════════════════════
// PART 1: Fix KOL weights based on ACTUAL SOL P&L
// ═══════════════════════════════════════════════════════════════════════════════
const KOL_FILE = process.env.HOME + '/.gizmo/runtime/kol-performance.json';
const kols = JSON.parse(fs.readFileSync(KOL_FILE, 'utf8'));

// MONEY MAKERS — boost and protect
if (kols.bandit) { kols.bandit.weight = 4; kols.bandit.tier = 'GOD'; kols.bandit.protected = true; kols.bandit.reason = '+1.354 SOL over 10 trades'; }
if (kols.Silver) { kols.Silver.weight = 3; kols.Silver.tier = 'ELITE'; kols.Silver.protected = true; kols.Silver.reason = '+0.482 SOL over 3 trades'; }
if (kols.Jijo)   { kols.Jijo.weight = 3; kols.Jijo.tier = 'ELITE'; kols.Jijo.protected = true; kols.Jijo.reason = '+0.331 SOL over 5 trades'; }
if (kols.radiance){ kols.radiance.protected = true; kols.radiance.reason = 'GOD tier, massive avg PnL'; } // already GOD

// MONEY LOSERS — demote and remove protection
if (kols.Cented) { kols.Cented.weight = 1; kols.Cented.tier = 'WATCH'; kols.Cented.protected = false; kols.Cented.reason = '-0.230 SOL over 21 trades'; }
if (kols.dv)     { kols.dv.weight = 1; kols.dv.tier = 'WATCH'; kols.dv.protected = false; kols.dv.reason = '-0.550 SOL over 15 trades'; }
if (kols.theo)   { kols.theo.weight = 0; kols.theo.tier = 'MUTED'; kols.theo.protected = false; kols.theo.reason = '-0.084 SOL over 8 trades, not worth risk'; }

// Already muted — keep muted
// decu, dov7, Joji, Pain, clukz — all confirmed losers

fs.writeFileSync(KOL_FILE, JSON.stringify(kols, null, 2));
console.log('✅ KOL weights set from ACTUAL SOL P&L:');
console.log('   🟢 bandit → GOD (w:4) +1.354 SOL PROTECTED');
console.log('   🟢 Silver → ELITE (w:3) +0.482 SOL PROTECTED');
console.log('   🟢 Jijo   → ELITE (w:3) +0.331 SOL PROTECTED');
console.log('   🟢 radiance → GOD (w:4) PROTECTED');
console.log('   🔴 Cented → WATCH (w:1) -0.230 SOL UNPROTECTED');
console.log('   🔴 dv     → WATCH (w:1) -0.550 SOL UNPROTECTED');
console.log('   🔴 theo   → MUTED (w:0) -0.084 SOL');

// ═══════════════════════════════════════════════════════════════════════════════
// PART 2: Patch gizmo.mjs — fix protection logic to use SOL P&L not totalPnl %
// ═══════════════════════════════════════════════════════════════════════════════
const FILE = process.env.HOME + '/.openclaw/workspace/SOLGizmo/gizmo.mjs';
const BACKUP = FILE + '.pre-v4-' + Date.now();
let code = fs.readFileSync(FILE, 'utf8');
fs.copyFileSync(FILE, BACKUP);
console.log('\n✅ Backup: ' + BACKUP);

let patchCount = 0;
function patch(label, oldStr, newStr) {
  if (!code.includes(oldStr)) { console.log('⚠️  SKIP (not found): ' + label); return false; }
  const count = code.split(oldStr).length - 1;
  if (count > 1) { console.log('⚠️  SKIP (multiple: ' + count + '): ' + label); return false; }
  code = code.replace(oldStr, newStr);
  patchCount++;
  console.log('✅ Patched: ' + label);
  return true;
}

// ─── FIX 1: Deep analysis protection — only protect KOLs with protected:true flag ──
// Remove the "positive totalPnl" auto-protection — that was wrong
// totalPnl (%) can be positive while SOL P&L is negative due to position sizing
patch('Fix protection to use flag only, not totalPnl',
  `        // PROTECTION: never mute a KOL with positive totalPnl or protected flag
        if (perfData[k].protected) {
          log('🛡️ PROTECTED KOL: ' + k + ' — deep analysis tried to mute, BLOCKED');
          changes.push('BLOCKED MUTE: ' + k + ' (protected)');
          continue;
        }
        if ((perfData[k].totalPnl || 0) > 0) {
          log('🛡️ POSITIVE PNL KOL: ' + k + ' (totalPnl: ' + (perfData[k].totalPnl||0).toFixed(1) + ') — refusing to mute');
          changes.push('BLOCKED MUTE: ' + k + ' (positive PnL)');
          continue;
        }`,
  `        // PROTECTION: only protect KOLs with explicit protected:true flag
        // (set based on actual SOL P&L, not % win rate)
        if (perfData[k].protected) {
          log('🛡️ PROTECTED KOL: ' + k + ' — deep analysis tried to mute, BLOCKED');
          changes.push('BLOCKED MUTE: ' + k + ' (protected — proven SOL profitable)');
          continue;
        }`
);

// ─── FIX 2: Protection floor — only restore protected flag KOLs ──
patch('Protection floor only for flagged KOLs',
  `      // PROTECTION FLOOR: restore protected KOLs if deep analysis demoted them
      for (const [k, v] of Object.entries(perfData)) {
        if (v.protected && v.weight < 2) {
          const oldW = v.weight;
          v.weight = Math.max(v.weight, 2);
          v.tier = v.weight >= 3 ? 'ELITE' : 'SOLID';
          if (oldW < 2) log('🛡️ RESTORED: ' + k + ' weight ' + oldW + ' → ' + v.weight + ' (protected floor)');
        }
      }`,
  `      // PROTECTION FLOOR: only restore KOLs with protected:true (proven SOL profitable)
      for (const [k, v] of Object.entries(perfData)) {
        if (v.protected === true && v.weight < 2) {
          const oldW = v.weight;
          v.weight = Math.max(v.weight, 3); // protected KOLs stay at least ELITE
          v.tier = v.weight >= 4 ? 'GOD' : 'ELITE';
          if (oldW < 3) log('🛡️ RESTORED: ' + k + ' weight ' + oldW + ' → ' + v.weight + ' (SOL profitable, protected)');
        }
      }`
);

// ─── FIX 3: Disable market scan entirely — focus only on KOL signals ──
// Market scan is -0.270 SOL. Not catastrophic but adding noise and burning capital.
// With only proven KOLs active, we want every SOL focused on their signals.
patch('Disable market scan — focus on proven KOLs only',
  `    if (cycle % 5 === 0) await marketScan();`,
  `    // MARKET SCAN DISABLED — was -0.270 SOL over 29 trades. Focus on proven KOL signals only.
    // if (cycle % 5 === 0) await marketScan();`
);

// ─── FIX 4: Watchlist re-entry disabled — stop re-buying tokens we already sold ──
// RIGGED was bought 3+ times today. Each re-entry is a coin flip that bleeds SOL.
patch('Disable watchlist re-entry',
  `async function checkWatchlist() {
  for (let i = WATCHLIST.length - 1; i >= 0; i--) {`,
  `async function checkWatchlist() {
  return; // DISABLED — stop re-buying tokens we already exited. Each re-entry bleeds SOL.
  for (let i = WATCHLIST.length - 1; i >= 0; i--) {`
);

// ─── FIX 5: HW KOL path — only trigger for weight >= 4 (GOD tier) ──
// Weight 3 solo buys were responsible for bad entries from Cented/dv
// Now only bandit (GOD) and radiance (GOD) can trigger solo buys
patch('HW KOL solo buy only for GOD tier (w:4+)',
  `  for (const signal of (state.recentBuys || []).filter(b => b.kolWeight >= 3 && !b.scalper)) {`,
  `  for (const signal of (state.recentBuys || []).filter(b => b.kolWeight >= 4 && !b.scalper)) {`
);

// But we also need to check live weight, not just static weight
patch('HW KOL live weight check raised to 4',
  `    if (hwLiveWeight === 0) {`,
  `    if (hwLiveWeight < 4) { if (hwLiveWeight === 0 && !_mutedLoggedThisCycle.has(signal.kol)) { _mutedLoggedThisCycle.add(signal.kol); log('🔇 SKIPPED KOL: ' + signal.kol + ' (w:' + hwLiveWeight + ' — need w:4 for solo buy)'); } ALERTED.add(signal.mint); continue; }
    if (false) {`
);

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE
// ═══════════════════════════════════════════════════════════════════════════════
fs.writeFileSync(FILE, code);

console.log('\n══════════════════════════════════════');
console.log('🦞 SUPERCELL v4 — DATA-DRIVEN: ' + patchCount + ' patches applied');
console.log('');
console.log('THE STRATEGY (based on actual SOL P&L):');
console.log('');
console.log('  WHO TRADES:');
console.log('    Solo buys: ONLY bandit (GOD) and radiance (GOD)');
console.log('    Convergence: bandit/radiance/Silver/Jijo combos');
console.log('    Cented/dv: only count in convergence at low weight');
console.log('    Market scan: OFF');
console.log('    Re-entry: OFF');
console.log('');
console.log('  HOW WE EXIT (from v3):');
console.log('    Losers: cut in 5 min');
console.log('    Winners: trail SL, never sell early');
console.log('    No DCA, no fast pump sell');
console.log('');
console.log('  RESULT: Fewer trades, only from proven profitable KOLs,');
console.log('  with tight loser management and open-ended upside.');
console.log('');
console.log('TO DEPLOY:');
console.log('  pkill -f "node gizmo.mjs"');
console.log('  sleep 2');
console.log('  cd ~/.openclaw/workspace/SOLGizmo && nohup node gizmo.mjs >> /dev/null 2>&1 &');
console.log('');
console.log('TO ROLLBACK:');
console.log('  cp ' + BACKUP + ' ' + FILE);
console.log('══════════════════════════════════════');

// Verify
const v = fs.readFileSync(FILE, 'utf8');
const checks = [
  ['MARKET SCAN DISABLED', 'Market scan off'],
  ['return; // DISABLED — stop re-buying', 'Watchlist re-entry off'],
  ['b.kolWeight >= 4', 'HW solo buy GOD only'],
  ['protected — proven SOL profitable', 'Protection uses flag only'],
  ['protected === true', 'Floor uses flag only'],
];
console.log('\n🔍 VERIFICATION:');
let ok = true;
for (const [needle, label] of checks) {
  var found = v.includes(needle);
  console.log(found ? '  ✅ ' + label : '  ❌ ' + label);
  if (!found) ok = false;
}
var k2 = JSON.parse(fs.readFileSync(KOL_FILE, 'utf8'));
console.log(k2.bandit.weight === 4 ? '  ✅ bandit GOD' : '  ❌ bandit not GOD');
console.log(k2.Silver.weight === 3 ? '  ✅ Silver ELITE' : '  ❌ Silver not ELITE');
console.log(k2.Cented.weight === 1 ? '  ✅ Cented demoted' : '  ❌ Cented not demoted');
console.log(k2.dv.weight === 1 ? '  ✅ dv demoted' : '  ❌ dv not demoted');
console.log(k2.Cented.protected === false ? '  ✅ Cented unprotected' : '  ❌ Cented still protected');
console.log(ok ? '\n🟢 ALL VERIFIED' : '\n🔴 SOME FAILED');
