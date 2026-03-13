import fs from 'fs';

const file = process.env.HOME + '/.openclaw/workspace/SOLGizmo/gizmo.mjs';
fs.copyFileSync(file, file + '.bak-weighted');

let code = fs.readFileSync(file, 'utf8');

// Replace the convergence check block
const old = `  for (const [mint, buys] of Object.entries(byMint)) {
    const uniqueKols = [...new Set(buys.map(b => b.kol))];
    const nonScalper = uniqueKols.filter(k => !WALLETS.find(w => w.name === k)?.scalper);
    if (uniqueKols.length < MIN_KOLS || nonScalper.length < 1 || ALERTED.has(mint)) continue;`;

const rep = `  for (const [mint, buys] of Object.entries(byMint)) {
    const uniqueKols = [...new Set(buys.map(b => b.kol))];
    const nonScalper = uniqueKols.filter(k => !WALLETS.find(w => w.name === k)?.scalper);

    // ── WEIGHTED CONVERGENCE SCORE ──────────────────────────────────────────
    // Each KOL contributes their weight to the score instead of just +1
    // Cented(3) + bandit(3) = score 6 = STRONG signal
    // theo(1) + Dali(1)     = score 2 = WEAK, likely skip
    // Minimum score of 4 required to buy (vs old: just 2 KOLs)
    const convergenceScore = uniqueKols.reduce((sum, kolName) => {
      const wallet = WALLETS.find(w => w.name === kolName);
      return sum + (wallet?.weight || 1);
    }, 0);
    const MIN_SCORE = 4; // require combined weight ≥ 4
    const hasElite = uniqueKols.some(k => (WALLETS.find(w => w.name === k)?.weight || 1) >= 3);

    if (ALERTED.has(mint)) continue;
    if (nonScalper.length < 1) continue;
    if (uniqueKols.length < MIN_KOLS && convergenceScore < MIN_SCORE) continue;
    // Allow solo elite KOL if their weight is 3+ (Cented alone = valid signal)
    if (uniqueKols.length < 2 && !hasElite) continue;

    log('📊 CONVERGENCE SCORE: ' + uniqueKols.map(k => k + '(' + (WALLETS.find(w => w.name === k)?.weight || 1) + ')').join(' + ') + ' = ' + convergenceScore);
    // ────────────────────────────────────────────────────────────────────────`;

if (!code.includes(old)) {
  console.error('❌ Could not find convergence block');
  process.exit(1);
}

// Also update the log line to show score
const oldLog = "log(`🔥 CONVERGENCE: ${info.symbol} | MC: $${Math.round(info.mcap)} | KOLs: ${uniqueKols.join(', ')} | ${totalSol.toFixed(1)} SOL`);";
const newLog = "log(`🔥 CONVERGENCE: ${info.symbol} | MC: $${Math.round(info.mcap)} | KOLs: ${uniqueKols.join(', ')} | Score: ${convergenceScore} | ${totalSol.toFixed(1)} SOL`);";

code = code.replace(old, rep);
if (code.includes(oldLog)) code = code.replace(oldLog, newLog);

fs.writeFileSync(file, code);
console.log('✅ Backed up to gizmo.mjs.bak-weighted');
console.log('✅ Weighted convergence score installed!');
console.log('');
console.log('   Score rules:');
console.log('   • Each KOL contributes their weight (1-3) to the score');
console.log('   • Minimum score of 4 required to buy');
console.log('   • Elite KOL (weight 3) can trigger solo buy');
console.log('   • theo+Dali = score 2 → BLOCKED');
console.log('   • Cented+bandit = score 6 → STRONG BUY');
console.log('   • Cented alone = score 3 → SOLO ELITE BUY');
