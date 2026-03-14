/**
 * 🦞 GIZMO SUPERCELL PATCH v3 — THE EXIT FIX
 * ─────────────────────────────────────────────
 * Run: node patch-supercell-v3.mjs
 *
 * PROBLEM: Gizmo sells winners at +40-87% but holds losers to -15 to -22%.
 *          That's backwards. Today: 42 buys, -0.43 SOL net. Overtrading + bad exits.
 *
 * FIXES:
 *  1. DISABLE fast pump sell — this is the #1 leak. Selling half at +40% caps upside.
 *     Instead, let trailing SL handle all profit-taking on the way up.
 *  2. FASTER loser exit — fresh tokens: cut at -12% after 5min (was -30% after 15-25min)
 *  3. RUNNER MODE at 1.3x instead of 1.5x — more tokens get the chance to run
 *  4. TIGHTER time exit — flat tokens cut at 10min not 25min for fresh launches
 *  5. RAISE score threshold back to 5 — stop overtrading on weak signals
 *  6. DCA disabled — stop averaging down into losers, that's bleeding SOL
 *  7. Trailing SL tighter on small gains — lock in profit earlier
 */

import fs from 'fs';

const FILE = process.env.HOME + '/.openclaw/workspace/SOLGizmo/gizmo.mjs';
const BACKUP = FILE + '.pre-v3-' + Date.now();
let code = fs.readFileSync(FILE, 'utf8');
fs.copyFileSync(FILE, BACKUP);
console.log('✅ Backup: ' + BACKUP);

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

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 1: DISABLE FAST PUMP SELL — this is the #1 profit killer
// It sells half at +40% which caps upside. Winners need to RUN.
// Replace with: just tighten the trailing SL when we're up big
// ═══════════════════════════════════════════════════════════════════════════════
patch('Disable fast pump sell — let winners run',
  `    // FAST PUMP: +30%+ fading momentum — sell half (skip if runner mode)
    if (!pos.tp1Hit && !pos.runnerMode && mc >= pos.entryMC * 1.40) {
      const bsRatio = buys / Math.max(sells, 1);
      if (m5 < 0 || bsRatio < 1.5) {
        log(\`💰 FAST PUMP SELL \${pos.name} +\${((mc / pos.entryMC - 1) * 100).toFixed(0)}% fading — selling half\`);
        if (await sell(pos.ca, '50%', pos.name, pos.entryMC, mc)) {
          pos.tp1Hit = true;
          // Tight SL on remaining 50%: trail at 88% of pump high, min breakeven
          pos.sl = Math.max(pos.sl || 0, mc * 0.88, pos.entryMC * 1.02);
          log(\`🔒 \${pos.name}: fast pump SL locked at $\${Math.round(pos.sl)} (88% of pump)\`);
          savePositions();
        }
        continue;
      }
    }`,
  `    // FAST PUMP: DISABLED — let trailing SL handle exits, don't cap upside
    // Instead: when up 40%+, just tighten the SL to protect gains
    if (!pos.tp1Hit && !pos.runnerMode && mc >= pos.entryMC * 1.40) {
      const tightSL = Math.max(pos.sl || 0, mc * 0.85, pos.entryMC * 1.15);
      if (tightSL > (pos.sl || 0)) {
        pos.sl = tightSL;
        savePositions();
        log(\`🔒 \${pos.name}: +\${((mc / pos.entryMC - 1) * 100).toFixed(0)}% — SL tightened to $\${Math.round(pos.sl)} (85% trail, +15% floor)\`);
      }
    }`
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 2: RUNNER MODE triggers at 1.3x instead of 1.5x
// More tokens get the chance to become runners instead of being sold
// ═══════════════════════════════════════════════════════════════════════════════
patch('Runner mode at 1.3x instead of 1.5x',
  `    // TP1: 1.5x — detect RUNNER or take normal profit
    if (!pos.tp1Hit && !pos.runnerMode && mc >= pos.entryMC * 1.5) {`,
  `    // TP1: 1.3x — detect RUNNER or take normal profit (lowered for more runners)
    if (!pos.tp1Hit && !pos.runnerMode && mc >= pos.entryMC * 1.3) {`
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 3: TP1 normal sell — only 15% instead of 25% (keep more riding)
// ═══════════════════════════════════════════════════════════════════════════════
patch('TP1 sell 25% → 15% (keep more riding)',
  `        // Normal TP1: not ripping hard enough — lock 25% profit
        log(\`🎯 TP1 \${pos.name} \${mult.toFixed(1)}x — locking 25%\`);
        if (await sell(pos.ca, '25%', pos.name, pos.entryMC, mc)) {`,
  `        // Normal TP1: not ripping hard enough — lock 15% profit (keep 85% riding)
        log(\`🎯 TP1 \${pos.name} \${mult.toFixed(1)}x — locking 15%\`);
        if (await sell(pos.ca, '15%', pos.name, pos.entryMC, mc)) {`
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 4: FASTER LOSER EXIT — fresh tokens cut at -12% after 5min
// Old: waited 15-25 min before cutting. That's 15-25 min of bleeding.
// ═══════════════════════════════════════════════════════════════════════════════
patch('Faster time exit for fresh tokens',
  `    else                          { flatLimit = 25;   downLimit = 15;  } // fresh launch — cut fast`,
  `    else                          { flatLimit = 12;   downLimit = 5;   } // fresh launch — cut FAST (was 25/15)`
);

// Also tighten 15-60min old tokens
patch('Tighter time exit for young tokens',
  `    else if (tokenAgeHours > 0.25){ flatLimit = 60;   downLimit = 30;  } // 15-60min — moderate`,
  `    else if (tokenAgeHours > 0.25){ flatLimit = 30;   downLimit = 12;  } // 15-60min — tighter (was 60/30)`
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 5: HARD STOP tighter — -25% instead of -30% with bad momentum
// ═══════════════════════════════════════════════════════════════════════════════
patch('Hard stop -30% → -25%',
  `    if (mc <= pos.entryMC * 0.70 && !pos.sl) {`,
  `    if (mc <= pos.entryMC * 0.75 && !pos.sl) {`
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 6: DISABLE DCA — stop averaging down into losers
// Every DCA is throwing good money after bad
// ═══════════════════════════════════════════════════════════════════════════════
patch('Disable DCA — stop bleeding into losers',
  `    // DCA: add to position if price dips back to entry zone (not top blasting)
    if (!pos.dcaAdded && pos.dcaSize > 0.02) {
      pos.dcaCycles = (pos.dcaCycles || 0) + 1;
      const dipPct = (mc - pos.entryMC) / pos.entryMC;
      const goodDip = dipPct >= -0.10 && dipPct <= 0.05; // within 10% below or 5% above entry
      const momentumOk = buys > sells && m5 > -2;
      if (goodDip && momentumOk && pos.dcaCycles >= 2 && (!pos.sl || mc > pos.sl)) {
        log(\`📉 DCA: \${pos.name} dipped to entry zone (\${(dipPct*100).toFixed(1)}%) — adding \${pos.dcaSize.toFixed(3)} SOL\`);
        if (await buy(pos.ca, pos.dcaSize)) {
          pos.dcaAdded = true;
          const newEntryMC = (pos.entryMC + mc) / 2; // average down
          pos.entryMC = newEntryMC;
          pos.tp1 = newEntryMC * 1.5;
          pos.tp2 = newEntryMC * 2.0;
          savePositions();
          log(\`✅ DCA filled — new avg entry: \${Math.round(newEntryMC)}\`);
        }
      } else if (pos.dcaCycles >= 5 && !pos.dcaAdded) {
        pos.dcaAdded = true; // timeout — skip DCA, missed the window
        savePositions();
        log(\`⏭️ DCA timeout: \${pos.name} — no dip after 5 cycles, skipping add\`);
      }
    }`,
  `    // DCA: DISABLED — stop throwing good money after bad
    // Winners don't need DCA, losers shouldn't get more capital
    if (!pos.dcaAdded) { pos.dcaAdded = true; }`
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 7: SL locks in earlier — at +8% instead of +10%
// ═══════════════════════════════════════════════════════════════════════════════
patch('SL locks at +8% instead of +10%',
  `      if (mc > pos.entryMC * 1.10 && !pos.sl) {
        pos.sl = pos.entryMC * 1.05;
        log(\`🟢 \${pos.name}: +10% — SL locked at +5%: $\${Math.round(pos.sl)}\`);`,
  `      if (mc > pos.entryMC * 1.08 && !pos.sl) {
        pos.sl = pos.entryMC * 1.04;
        log(\`🟢 \${pos.name}: +8% — SL locked at +4%: $\${Math.round(pos.sl)}\`);`
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 8: Trailing SL starts at +12% instead of +15%
// ═══════════════════════════════════════════════════════════════════════════════
patch('Trailing SL starts at +12% instead of +15%',
  `      if (pos.sl && pos.highMC > pos.entryMC * 1.15) {`,
  `      if (pos.sl && pos.highMC > pos.entryMC * 1.12) {`
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 9: Raise score threshold — stop buying weak signals
// ═══════════════════════════════════════════════════════════════════════════════
const LEARN_FILE = process.env.HOME + '/.gizmo/runtime/learn-state.json';
try {
  const learn = JSON.parse(fs.readFileSync(LEARN_FILE, 'utf8'));
  learn.scoreThreshold = 5;
  learn.minKols = 2;
  fs.writeFileSync(LEARN_FILE, JSON.stringify(learn, null, 2));
  console.log('✅ Score threshold → 5, minKols → 2 (stop overtrading)');
} catch(e) { console.log('⚠️  Learn state update failed: ' + e.message); }

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 10: Market scan score minimum raised from 4 to 5
// ═══════════════════════════════════════════════════════════════════════════════
patch('Market scan score minimum 4 → 5',
  `      if (score < 4) continue;`,
  `      if (score < 5) continue;`
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 11: Rug detect tighter — -40% in 3min instead of -55% in 4min
// ═══════════════════════════════════════════════════════════════════════════════
patch('Rug detect tighter',
  `    if (minsHeld < 4 && mc <= pos.entryMC * 0.45) {  // tightened: only exit on -55%+ in 4 mins`,
  `    if (minsHeld < 3 && mc <= pos.entryMC * 0.60) {  // SUPERCELL v3: exit on -40%+ in 3 mins`
);

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE
// ═══════════════════════════════════════════════════════════════════════════════
fs.writeFileSync(FILE, code);

console.log('\n══════════════════════════════════════');
console.log('🦞 SUPERCELL v3 — THE EXIT FIX: ' + patchCount + ' patches applied');
console.log('');
console.log('WHAT CHANGED:');
console.log('  ❌ Fast pump sell DISABLED — no more selling winners at +40%');
console.log('  ❌ DCA DISABLED — no more throwing SOL at losers');
console.log('  ⚡ Fresh token losers cut at 5min/-12% (was 15min/-22%)');
console.log('  ⚡ Young token losers cut at 12min (was 30min)');
console.log('  ⚡ Hard stop at -25% (was -30%)');
console.log('  ⚡ Rug detect at -40%/3min (was -55%/4min)');
console.log('  🏃 Runner mode at 1.3x (was 1.5x)');
console.log('  🏃 TP1 sells only 15% (was 25%)');
console.log('  🔒 SL locks at +8%/+4% (was +10%/+5%)');
console.log('  🔒 Trailing SL starts at +12% (was +15%)');
console.log('  📊 Score threshold → 5, market scan min → 5');
console.log('');
console.log('THE LOGIC: Kill losers in 5 min. Let winners ride.');
console.log('           Trail the SL up. Never sell early.');
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
  ['FAST PUMP: DISABLED', 'Fast pump sell disabled'],
  ['DCA: DISABLED', 'DCA disabled'],
  ['flatLimit = 12;   downLimit = 5;', 'Fast loser exit'],
  ['pos.entryMC * 1.3)', 'Runner mode 1.3x'],
  ['locking 15%', 'TP1 15% sell'],
  ['pos.entryMC * 1.08', 'SL lock at +8%'],
  ['pos.entryMC * 1.12)', 'Trailing SL at +12%'],
  ['pos.entryMC * 0.75', 'Hard stop -25%'],
  ['pos.entryMC * 0.60)', 'Rug detect -40%/3min'],
  ['if (score < 5) continue', 'Market scan score 5+'],
];
console.log('\n🔍 VERIFICATION:');
let ok = true;
for (const [needle, label] of checks) {
  const found = v.includes(needle);
  console.log(found ? '  ✅ ' + label : '  ❌ ' + label);
  if (!found) ok = false;
}
console.log(ok ? '\n🟢 ALL VERIFIED' : '\n🔴 SOME FAILED');
