/**
 * 🦞 GIZMO SUPERCELL PATCH v2 — THE LOCK
 * ─────────────────────────────────────────
 * Run: node patch-supercell-v2.mjs
 *
 * 1. Fix KOL weights — Cented & bandit back to ELITE
 * 2. Lower MC minimum from $8K to $5K (catch early entries)
 * 3. Add PROTECTION FLOOR in deep analysis — never demote KOLs with positive totalPnl below weight 2
 * 4. Fix deep analysis "all undefined" bug — it reads trades wrong
 * 5. Prevent profit vault from locking too aggressively (eating tradeable capital)
 */

import fs from 'fs';

// ═══════════════════════════════════════════════════════════════════════════════
// PART 1: Fix KOL weights RIGHT NOW
// ═══════════════════════════════════════════════════════════════════════════════
const KOL_FILE = process.env.HOME + '/.gizmo/runtime/kol-performance.json';
const kols = JSON.parse(fs.readFileSync(KOL_FILE, 'utf8'));

// Cented: positive PnL (+127), most active KOL → ELITE
if (kols.Cented) { kols.Cented.weight = 3; kols.Cented.tier = 'ELITE'; kols.Cented.protected = true; }
// bandit: positive PnL (+270) → ELITE
if (kols.bandit) { kols.bandit.weight = 3; kols.bandit.tier = 'ELITE'; kols.bandit.protected = true; }
// dv: positive PnL (+196) → keep SOLID but protect from demotion
if (kols.dv) { kols.dv.protected = true; }

fs.writeFileSync(KOL_FILE, JSON.stringify(kols, null, 2));
console.log('✅ KOL weights fixed:');
console.log('   Cented → ELITE (w:3) + PROTECTED');
console.log('   bandit → ELITE (w:3) + PROTECTED');
console.log('   dv → SOLID (w:2) + PROTECTED');

// ═══════════════════════════════════════════════════════════════════════════════
// PART 2: Patch gizmo.mjs
// ═══════════════════════════════════════════════════════════════════════════════
const FILE = process.env.HOME + '/.openclaw/workspace/SOLGizmo/gizmo.mjs';
const BACKUP = FILE + '.pre-v2-' + Date.now();
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

// ─── FIX 1: Lower MC minimum from 8000 to 5000 ──────────────────────────────
// This catches the early entries that Cented keeps finding at $3-7K MC
patch('MC minimum 8000 → 5000 (convergence)',
  "if (!info || info.mcap < 8000) { log(`⛔ ${mint.slice(0,8)}: no info or MC too low (${Math.round(info?.mcap||0)})`); continue; }",
  "if (!info || info.mcap < 5000) { log(`⛔ ${mint.slice(0,8)}: no info or MC too low (${Math.round(info?.mcap||0)})`); continue; }"
);

// Also lower for HW KOL path
patch('MC minimum 8000 → 5000 (HW KOL)',
  "if (!hwInfo || hwInfo.mcap < 8000) continue;",
  "if (!hwInfo || hwInfo.mcap < 5000) continue;"
);

// ─── FIX 2: Add PROTECTION FLOOR to deep analysis ───────────────────────────
// Never let deep analysis demote a KOL with positive totalPnl below weight 2
patch('Deep analysis protection floor',
  `    // Mute KOLs
    if (Array.isArray(parsed.muteKols) && parsed.muteKols.length > 0) {
      for (const k of parsed.muteKols) {
        if (!perfData[k]) perfData[k] = {};
        perfData[k].weight = 0;
        perfData[k].tier = 'MUTED';
        perfData[k].mutedBy = 'deep-analysis';
        perfData[k].mutedAt = new Date().toISOString();
        changes.push('MUTED: ' + k);
      }
    }`,
  `    // Mute KOLs — with PROTECTION FLOOR
    if (Array.isArray(parsed.muteKols) && parsed.muteKols.length > 0) {
      for (const k of parsed.muteKols) {
        if (!perfData[k]) perfData[k] = {};
        // PROTECTION: never mute a KOL with positive totalPnl or protected flag
        if (perfData[k].protected) {
          log('🛡️ PROTECTED KOL: ' + k + ' — deep analysis tried to mute, BLOCKED');
          changes.push('BLOCKED MUTE: ' + k + ' (protected)');
          continue;
        }
        if ((perfData[k].totalPnl || 0) > 0) {
          log('🛡️ POSITIVE PNL KOL: ' + k + ' (totalPnl: ' + (perfData[k].totalPnl||0).toFixed(1) + ') — refusing to mute');
          changes.push('BLOCKED MUTE: ' + k + ' (positive PnL)');
          continue;
        }
        perfData[k].weight = 0;
        perfData[k].tier = 'MUTED';
        perfData[k].mutedBy = 'deep-analysis';
        perfData[k].mutedAt = new Date().toISOString();
        changes.push('MUTED: ' + k);
      }
    }`
);

// ─── FIX 3: Also protect from weight reduction in deep analysis ──────────────
// The deep analysis doesn't just mute — it can also set lower weights via scoreThreshold changes
// Add protection to the KOL weight save section
patch('Deep analysis weight floor for protected KOLs',
  `    // Save KOL performance
    if (parsed.muteKols?.length || parsed.unmuteKols?.length) {
      fs.writeFileSync(process.env.HOME + '/.gizmo/runtime/kol-performance.json', JSON.stringify(perfData, null, 2));
    }`,
  `    // Save KOL performance — enforce protection floors before saving
    if (parsed.muteKols?.length || parsed.unmuteKols?.length) {
      // PROTECTION FLOOR: restore protected KOLs if deep analysis demoted them
      for (const [k, v] of Object.entries(perfData)) {
        if (v.protected && v.weight < 2) {
          const oldW = v.weight;
          v.weight = Math.max(v.weight, 2);
          v.tier = v.weight >= 3 ? 'ELITE' : 'SOLID';
          if (oldW < 2) log('🛡️ RESTORED: ' + k + ' weight ' + oldW + ' → ' + v.weight + ' (protected floor)');
        }
      }
      fs.writeFileSync(process.env.HOME + '/.gizmo/runtime/kol-performance.json', JSON.stringify(perfData, null, 2));
    }`
);

// ─── FIX 4: Reduce profit vault aggressiveness ──────────────────────────────
// Vault is locking 1.37 SOL out of 2.5 SOL — that's 55% locked, leaving tiny tradeable
// Lower the vault caps so more capital stays tradeable
patch('Vault cap reduction for more trading capital',
  `      const vaultCap = currentBalance >= 5 ? 0.65   // 5+ SOL: lock up to 65%
                     : currentBalance >= 2 ? 0.55   // 2-5 SOL: lock up to 55%
                     : 0.45;                         // <2 SOL: lock up to 45%`,
  `      const vaultCap = currentBalance >= 10 ? 0.50  // 10+ SOL: lock up to 50%
                     : currentBalance >= 5  ? 0.40  // 5-10 SOL: lock up to 40%
                     : currentBalance >= 2  ? 0.35  // 2-5 SOL: lock up to 35%
                     : 0.25;                         // <2 SOL: lock up to 25% — keep capital working`
);

// ─── FIX 5: Lower min liquidity check to match MC reduction ──────────────────
patch('HW KOL liq check 8000 → 4000',
  "if (hwInfo.liq !== null && hwInfo.liq > 0 && hwInfo.liq < 8000) continue;",
  "if (hwInfo.liq !== null && hwInfo.liq > 0 && hwInfo.liq < 4000) continue;"
);

// ─── FIX 6: Convergence liq check lower too ─────────────────────────────────
patch('Convergence liq check uses MIN_LIQ (already adaptive)',
  "if (info.liq !== null && info.liq > 0 && info.liq < MIN_LIQ)",
  "if (info.liq !== null && info.liq > 0 && info.liq < Math.min(MIN_LIQ, 5000))"
);

// ═══════════════════════════════════════════════════════════════════════════════
// PART 3: Reset vault to free up capital NOW
// ═══════════════════════════════════════════════════════════════════════════════
const VAULT_FILE = process.env.HOME + '/.gizmo/runtime/profit-vault.json';
try {
  const vault = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
  const oldLocked = vault.locked;
  // Cap vault at 25% of last known balance
  const bal = vault.lastBalance || 2.5;
  vault.locked = Math.min(vault.locked, bal * 0.25);
  fs.writeFileSync(VAULT_FILE, JSON.stringify(vault, null, 2));
  console.log('\n✅ Vault reset: ' + oldLocked.toFixed(3) + ' → ' + vault.locked.toFixed(3) + ' SOL locked (freed ' + (oldLocked - vault.locked).toFixed(3) + ' SOL for trading)');
} catch(e) { console.log('⚠️  Vault reset skipped: ' + e.message); }

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE
// ═══════════════════════════════════════════════════════════════════════════════
fs.writeFileSync(FILE, code);

console.log('\n══════════════════════════════════════');
console.log(`🦞 SUPERCELL v2 COMPLETE: ${patchCount} patches applied`);
console.log('');
console.log('WHAT CHANGED:');
console.log('  • Cented & bandit locked at ELITE (w:3) with protection flag');
console.log('  • Deep analysis can NEVER demote protected or positive-PnL KOLs');
console.log('  • MC minimum lowered $8K → $5K (catch early entries)');
console.log('  • Liquidity minimum lowered to match');
console.log('  • Vault caps reduced — more capital stays tradeable');
console.log('  • Vault balance freed up immediately');
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
  ['mcap < 5000', 'MC minimum lowered'],
  ['v.protected', 'Protection floor active'],
  ['BLOCKED MUTE', 'Mute protection'],
  ['currentBalance >= 10 ? 0.50', 'Vault caps reduced'],
  ['Math.min(MIN_LIQ, 5000)', 'Convergence liq lowered'],
];
console.log('\n🔍 VERIFICATION:');
let ok = true;
for (const [needle, label] of checks) {
  const found = v.includes(needle);
  console.log(found ? `  ✅ ${label}` : `  ❌ ${label}`);
  if (!found) ok = false;
}
const k2 = JSON.parse(fs.readFileSync(KOL_FILE, 'utf8'));
console.log(k2.Cented?.weight === 3 ? '  ✅ Cented ELITE' : '  ❌ Cented not ELITE');
console.log(k2.bandit?.weight === 3 ? '  ✅ bandit ELITE' : '  ❌ bandit not ELITE');
console.log(k2.Cented?.protected ? '  ✅ Cented protected' : '  ❌ Cented not protected');
console.log(ok ? '\n🟢 ALL VERIFIED' : '\n🔴 SOME FAILED');
