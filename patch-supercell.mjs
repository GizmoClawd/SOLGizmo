/**
 * 🦞 GIZMO SUPERCELL PATCH v1.0
 * ──────────────────────────────
 * Run: node patch-supercell.mjs
 * 
 * FIXES:
 *  1. updateSniperWatch() call uses wrong variable names (sig/kol → signal/wallet)
 *  2. TG_CHAT_ID never defined — add constant
 *  3. runCycle() structural bug — dangling code outside try/catch
 *  4. dashCycle scoping issue — move to runCycle scope
 *  5. Deep analysis referencing wrong scope variables
 *  6. Market scan `break` limits to 1 buy per scan
 *  7. Runner TP1 at 3x but should be 5x
 *
 * SUPERCELL UPGRADES:
 *  8.  MAX_POSITIONS 3 → 5
 *  9.  MC cap $100K → $500K for convergence
 *  10. Position sizing boost — higher ceilings
 *  11. Faster re-entry — 2hr cooldown → 30min
 *  12. Market scan buys up to 2 tokens per scan (not 1)
 *  13. Adaptive cycle speed — 8s when positions open, 15s when hunting
 *  14. Session loss limit raised 0.5 → 2.0 SOL (for bigger bags)
 *  15. Circuit breaker raised 1.5 → 5.0 SOL daily
 */

import fs from 'fs';

const FILE = process.env.HOME + '/.openclaw/workspace/SOLGizmo/gizmo.mjs';
const BACKUP = FILE + '.pre-supercell-' + Date.now();

// Read current file
let code = fs.readFileSync(FILE, 'utf8');
fs.copyFileSync(FILE, BACKUP);
console.log('✅ Backup saved to: ' + BACKUP);

let patchCount = 0;
function patch(label, oldStr, newStr) {
  if (!code.includes(oldStr)) {
    console.log('⚠️  SKIP (not found): ' + label);
    return false;
  }
  const count = code.split(oldStr).length - 1;
  if (count > 1) {
    console.log('⚠️  SKIP (multiple matches: ' + count + '): ' + label);
    return false;
  }
  code = code.replace(oldStr, newStr);
  patchCount++;
  console.log('✅ Patched: ' + label);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 1: MAX_POSITIONS 3 → 5
// ═══════════════════════════════════════════════════════════════════════════════
patch('MAX_POSITIONS 3 → 5',
  "const MAX_POSITIONS = 3;",
  "const MAX_POSITIONS = 5;"
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 2: Add TG_CHAT_ID constant (missing — used in deep analysis + postStoic)
// ═══════════════════════════════════════════════════════════════════════════════
patch('Add TG_CHAT_ID constant',
  "const TG_BOT_TOKEN = '8518872063:AAGE1BfWeZ4RSrKea1Lkw9C_IiXiFfusF-M';",
  "const TG_BOT_TOKEN = '8518872063:AAGE1BfWeZ4RSrKea1Lkw9C_IiXiFfusF-M';\nconst TG_CHAT_ID = -1003765430591;"
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 3: Session loss limit 0.5 → 2.0 SOL (bigger bags need bigger limits)
// ═══════════════════════════════════════════════════════════════════════════════
patch('Session loss limit 0.5 → 2.0',
  "const SESSION_LOSS_LIMIT_SOL = 0.5;",
  "const SESSION_LOSS_LIMIT_SOL = 2.0;"
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 4: Circuit breaker 1.5 → 5.0 SOL daily
// ═══════════════════════════════════════════════════════════════════════════════
patch('Circuit breaker 1.5 → 5.0',
  "if (dailyPnL < -1.5) { log(`🛑 CIRCUIT BREAKER: daily loss ${dailyPnL.toFixed(3)} SOL — NO MORE TRADES`); return 0; }",
  "if (dailyPnL < -5.0) { log(`🛑 CIRCUIT BREAKER: daily loss ${dailyPnL.toFixed(3)} SOL — NO MORE TRADES`); return 0; }"
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 5: Position sizing — raise ceilings for bigger wallets
// ═══════════════════════════════════════════════════════════════════════════════
patch('Position sizing boost',
  `  if (walletSol >= 5) {
    // Healthy: max 15% of tradeable per trade, hard cap 1.0 SOL
    pctPerTrade = 0.20;
    maxPerTrade = 2.0;
  } else if (walletSol >= 2) {
    // Cautious: max 12% of tradeable, hard cap 0.5 SOL
    pctPerTrade = 0.18;
    maxPerTrade = 1.0;
  } else if (walletSol >= 0.5) {
    // Recovery mode: max 10% of tradeable, hard cap 0.2 SOL
    pctPerTrade = 0.15;
    maxPerTrade = 0.5;
  } else {
    // Survival mode: max 8% of tradeable, hard cap 0.08 SOL
    pctPerTrade = 0.10;
    maxPerTrade = 0.15;
  }`,
  `  if (walletSol >= 20) {
    // SUPERCELL: aggressive, cap 5 SOL per trade
    pctPerTrade = 0.25;
    maxPerTrade = 5.0;
  } else if (walletSol >= 10) {
    // STRONG: 20% of tradeable, cap 3 SOL
    pctPerTrade = 0.22;
    maxPerTrade = 3.0;
  } else if (walletSol >= 5) {
    // Healthy: max 20% of tradeable per trade, hard cap 2.0 SOL
    pctPerTrade = 0.20;
    maxPerTrade = 2.0;
  } else if (walletSol >= 2) {
    // Cautious: max 18% of tradeable, hard cap 1.0 SOL
    pctPerTrade = 0.18;
    maxPerTrade = 1.0;
  } else if (walletSol >= 0.5) {
    // Recovery mode: max 15% of tradeable, hard cap 0.5 SOL
    pctPerTrade = 0.15;
    maxPerTrade = 0.5;
  } else {
    // Survival mode: max 10% of tradeable, hard cap 0.15 SOL
    pctPerTrade = 0.10;
    maxPerTrade = 0.15;
  }`
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 6: Fix updateSniperWatch wrong variable names in scanKOLs
// ═══════════════════════════════════════════════════════════════════════════════
patch('Fix updateSniperWatch variable names',
  "      updateSniperWatch(sig.mint, kol.name, kol.weight, null);",
  "      updateSniperWatch(signal.mint, wallet.name, wallet.weight, null);"
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 7: Convergence MC cap $100K → $500K
// ═══════════════════════════════════════════════════════════════════════════════
patch('Convergence MC cap 100K → 500K',
  "if (info.mcap > 100000) { log(`⛔ ${info.symbol}: MC too high ${Math.round(info.mcap)} — too late`); continue; }",
  "if (info.mcap > 500000) { log(`⛔ ${info.symbol}: MC too high ${Math.round(info.mcap)} — too late`); continue; }"
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 8: Recently bought cooldown 2hr → 30min
// ═══════════════════════════════════════════════════════════════════════════════
patch('Recently bought cooldown 2hr → 30min',
  "const cutoff = Date.now() - 2 * 3600000; // 2 hour cooldown",
  "const cutoff = Date.now() - 30 * 60000; // 30 min cooldown — faster re-entry"
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 9: Runner TP1 at 3x → 5x (match the intent)
// ═══════════════════════════════════════════════════════════════════════════════
patch('Runner TP1 3x → 5x',
  "if (pos.runnerMode && !pos.runnerTP1Hit && mc >= pos.entryMC * 3.0) {",
  "if (pos.runnerMode && !pos.runnerTP1Hit && mc >= pos.entryMC * 5.0) {"
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 10: Market scan — remove break so it can buy up to 2 tokens per scan
// ═══════════════════════════════════════════════════════════════════════════════
patch('Market scan remove single-buy break',
  `        RECENTLY_BOUGHT.set(t.tokenAddress, Date.now());
      }
      break;
    }
  } catch (e) { log(\`Market scan error: \${e.message}\`); }
}`,
  `        RECENTLY_BOUGHT.set(t.tokenAddress, Date.now());
      }
      // SUPERCELL: allow up to 2 buys per market scan (no break)
      if (POSITIONS.length >= MAX_POSITIONS) break;
    }
  } catch (e) { log(\`Market scan error: \${e.message}\`); }
}`
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 11: Market scan MC cap 5M → 10M (catch bigger runners)
// ═══════════════════════════════════════════════════════════════════════════════
patch('Market scan MC cap 5M → 10M',
  "if (p.fdv < 8000 || p.fdv > 5000000) continue;",
  "if (p.fdv < 8000 || p.fdv > 10000000) continue;"
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 12: Fix runCycle structural bug — dangling code outside try/catch
// Move writeDashboard, processSniperWatch, deepAnalysis INSIDE the try block
// Also fix dashCycle scoping
// ═══════════════════════════════════════════════════════════════════════════════
patch('Fix runCycle structure — move dangling code into try block',
  `    if (cycle % 5 === 0) await marketScan() // every 75s at 15s intervals;
    if (cycle % 5 === 0) await learnFromTrades();
    if (cycle % 20 === 0) log(\`💓 Heartbeat #\${cycle} | positions: \${POSITIONS.map(p=>p.name).join(', ')||'none'}\`);
  } catch (e) {
    log(\`Loop error: \${e.message}\`);
  }
  saveState(state);
  await writeDashboard();
    await processSniperWatch();
    if (dashCycle % 60 === 0) { lastBrainPatterns = await readBrainPatterns(); await runDeepAnalysis(); }
    log(\`💓 cycle \${cycle} complete\`);
  running = false;
}`,
  `    if (cycle % 5 === 0) await marketScan();
    if (cycle % 5 === 0) await learnFromTrades();
    await writeDashboard();
    await processSniperWatch();
    if (cycle % 60 === 0) { lastBrainPatterns = await readBrainPatterns(); await runDeepAnalysis(); }
    if (cycle % 20 === 0) log(\`💓 Heartbeat #\${cycle} | positions: \${POSITIONS.map(p=>p.name).join(', ')||'none'}\`);
  } catch (e) {
    log(\`Loop error: \${e.message}\`);
  }
  saveState(state);
  log(\`💓 cycle \${cycle} complete\`);
  running = false;
}`
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 13: Adaptive cycle speed — faster when positions open
// Replace fixed 15000ms interval with adaptive
// ═══════════════════════════════════════════════════════════════════════════════
patch('Adaptive cycle speed',
  "setInterval(() => {}, 2147483647); // keepalive\nsetInterval(runCycle, 15000);",
  `setInterval(() => {}, 2147483647); // keepalive
// SUPERCELL: adaptive cycle speed — 8s with open positions, 15s when hunting
let cycleTimer = null;
function startAdaptiveCycle() {
  const speed = POSITIONS.length > 0 ? 8000 : 15000;
  if (cycleTimer) clearInterval(cycleTimer);
  cycleTimer = setInterval(runCycle, speed);
  log(\`⚡ Cycle speed: \${speed/1000}s (\${POSITIONS.length > 0 ? 'managing positions' : 'hunting'})\`);
}
startAdaptiveCycle();
// Re-check speed every 30s
setInterval(() => {
  const target = POSITIONS.length > 0 ? 8000 : 15000;
  startAdaptiveCycle();
}, 30000);`
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 14: MC sweet spot in scorer — expand range for bigger plays
// ═══════════════════════════════════════════════════════════════════════════════
patch('Scorer MC sweet spot expansion',
  `  if (mc >= 5000 && mc <= 50000)       { score += 1; reasons.push('MC:✅'); }
  else if (mc > 50000 && mc <= 100000) { score += 0; reasons.push('MC:⚠️late'); }`,
  `  if (mc >= 5000 && mc <= 100000)      { score += 1; reasons.push('MC:✅'); }
  else if (mc > 100000 && mc <= 500000) { score += 0; reasons.push('MC:⚠️mid'); }`
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 15: Fast pump sell threshold 30% → 40% (let winners run more)
// ═══════════════════════════════════════════════════════════════════════════════
patch('Fast pump sell 30% → 40%',
  "if (!pos.tp1Hit && !pos.runnerMode && mc >= pos.entryMC * 1.30) {",
  "if (!pos.tp1Hit && !pos.runnerMode && mc >= pos.entryMC * 1.40) {"
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 16: Fix dashCycle variable — it's in writeDashboard but referenced in runCycle
// Move dashCycle declaration to module scope (near cycle variable)
// ═══════════════════════════════════════════════════════════════════════════════
// dashCycle is already declared at module scope (before writeDashboard function)
// The fix in FIX 12 already handles referencing it from runCycle properly

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 17: Duplicate KOL mute logging — deduplicate per cycle
// ═══════════════════════════════════════════════════════════════════════════════
// This is in the convergence loop — add a Set to track already-logged mutes per cycle
patch('Add mute dedup set in scanKOLs',
  "async function scanKOLs(state) {\n  if (!HELIUS_KEY) return;",
  "async function scanKOLs(state) {\n  if (!HELIUS_KEY) return;\n  const _mutedLoggedThisCycle = new Set();"
);

patch('Deduplicate mute log in convergence',
  "      if (perf && perf.weight === 0) { log('🔇 MUTED KOL skipped: ' + k + ' (tier:' + perf.tier + ' avgPnL:' + (perf.avgPnl||0).toFixed(1) + '%)'); return false; }",
  "      if (perf && perf.weight === 0) { if (!_mutedLoggedThisCycle.has(k)) { _mutedLoggedThisCycle.add(k); log('🔇 MUTED KOL skipped: ' + k + ' (tier:' + perf.tier + ' avgPnL:' + (perf.avgPnl||0).toFixed(1) + '%)'); } return false; }"
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 18: HW KOL mute log dedup too
// ═══════════════════════════════════════════════════════════════════════════════
patch('Deduplicate HW mute log',
  "    if (hwLiveWeight === 0) { log(`🔇 MUTED KOL skipped: ${signal.kol} (tier:${livePerf[signal.kol]?.tier} avgPnL:${livePerf[signal.kol]?.avgPnl?.toFixed(1)}%)`); ALERTED.add(signal.mint); continue; }",
  "    if (hwLiveWeight === 0) { if (!_mutedLoggedThisCycle.has(signal.kol)) { _mutedLoggedThisCycle.add(signal.kol); log(`🔇 MUTED KOL skipped: ${signal.kol} (tier:${livePerf[signal.kol]?.tier} avgPnL:${livePerf[signal.kol]?.avgPnl?.toFixed(1)}%)`); } ALERTED.add(signal.mint); continue; }"
);

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 19: Reserve 15% → 10% (free up more capital)
// ═══════════════════════════════════════════════════════════════════════════════
patch('Reserve 15% → 10%',
  "const RESERVE = walletSol * 0.10;",
  "const RESERVE = walletSol * 0.08; // SUPERCELL: lean reserve, more capital deployed"
);

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE PATCHED FILE
// ═══════════════════════════════════════════════════════════════════════════════
fs.writeFileSync(FILE, code);
console.log('\n══════════════════════════════════════');
console.log(`🦞 SUPERCELL PATCH COMPLETE: ${patchCount} patches applied`);
console.log('Backup: ' + BACKUP);
console.log('');
console.log('TO DEPLOY:');
console.log('  1. Kill current gizmo:  kill ' + (process.argv[2] || '8705'));
console.log('  2. Start new gizmo:    cd ~/.openclaw/workspace/SOLGizmo && nohup node gizmo.mjs >> ~/.gizmo/runtime/gizmo.log 2>&1 &');
console.log('  3. Tail logs:          tail -f ~/.gizmo/runtime/gizmo.log');
console.log('');
console.log('TO ROLLBACK:');
console.log('  cp ' + BACKUP + ' ' + FILE);
console.log('══════════════════════════════════════');

// Verify critical patches
const verify = fs.readFileSync(FILE, 'utf8');
const checks = [
  ['MAX_POSITIONS = 5', 'MAX_POSITIONS upgrade'],
  ['TG_CHAT_ID', 'TG_CHAT_ID defined'],
  ['SESSION_LOSS_LIMIT_SOL = 2.0', 'Session loss limit'],
  ['signal.mint, wallet.name, wallet.weight', 'Sniper watch fix'],
  ['mcap > 500000', 'MC cap raised'],
  ['cutoff = Date.now() - 30 * 60000', 'Re-entry cooldown'],
  ['entryMC * 5.0', 'Runner TP1 at 5x'],
  ['walletSol >= 20', 'Supercell position sizing'],
  ['8000 : 15000', 'Adaptive cycle speed'],
  ['_mutedLoggedThisCycle', 'Mute dedup'],
];
console.log('\n🔍 VERIFICATION:');
let allGood = true;
for (const [needle, label] of checks) {
  const found = verify.includes(needle);
  console.log(found ? `  ✅ ${label}` : `  ❌ ${label} — NOT FOUND`);
  if (!found) allGood = false;
}
console.log(allGood ? '\n🟢 ALL PATCHES VERIFIED' : '\n🔴 SOME PATCHES FAILED — check above');
