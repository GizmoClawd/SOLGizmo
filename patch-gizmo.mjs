import fs from 'fs';

const file = process.env.HOME + '/.openclaw/workspace/SOLGizmo/gizmo.mjs';

// Backup first
fs.copyFileSync(file, file + '.bak2');
console.log('✅ Backed up to gizmo.mjs.bak2');

let code = fs.readFileSync(file, 'utf8');

const oldSell = `// ─── SELL ─────────────────────────────────────────────────────────────────────
async function sell(ca, pct, posName, entryMC, currentMC) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = spawnSync('node', ['sell.mjs', ca, pct], { cwd: WORKSPACE, timeout: 60000, encoding: 'utf8' });
      const out = (result.stdout || '') + (result.stderr || '');
      log(\`SELL \${pct} attempt \${attempt}: \${out.trim().split('\\n').pop()}\`);
      if (out.includes('CONFIRMED')) {
        const solMatch = out.match(/sold for ~([\\d.]+) SOL/);
        const txMatch = out.match(/TX: https:\\/\\/solscan\\.io\\/tx\\/(\\S+)/);
        const solReceived = solMatch ? parseFloat(solMatch[1]) : null;
        const txSig = txMatch ? txMatch[1] : null;
        const pnlPct = entryMC && currentMC ? ((currentMC - entryMC) / entryMC * 100) : null;
        logTrade('SELL', posName || ca.slice(0, 8), ca, solReceived, solReceived,
          txSig, \`Sold \${pct}\${pnlPct !== null ? ' | PnL: ' + (pnlPct > 0 ? '+' : '') + pnlPct.toFixed(1) + '%' : ''}\`);
        return true;
      }
      if (out.includes('No tokens to sell')) { log(\`ℹ️ \${posName}: no tokens (already sold)\`); return true; }
    } catch (e) { log(\`SELL failed attempt \${attempt}: \${e.message?.slice(0, 100)}\`); }
    if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
  }
  log(\`🚨 SELL FAILED ALL 3 ATTEMPTS on \${posName} — MANUAL ACTION NEEDED\`);
  try { fs.writeFileSync(BASE_DIR + '/SELL_FAILED_URGENT.txt', \`SELL FAILED: \${posName} (\${ca}) at \${new Date().toISOString()}\\nManual: cd \${WORKSPACE} && node sell.mjs \${ca} 100%\\n\`); } catch {}
  try { execSync(\`openclaw system event --text "🚨 SELL FAILED: \${posName} — manual action needed!" --mode now\`, { timeout: 5000 }); } catch {}
  return false;
}`;

const newSell = `// ─── SELL ─────────────────────────────────────────────────────────────────────
async function sell(ca, pct, posName, entryMC, currentMC) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = spawnSync('node', ['sell.mjs', ca, pct], { cwd: WORKSPACE, timeout: 60000, encoding: 'utf8' });
      const out = (result.stdout || '') + (result.stderr || '');
      log(\`SELL \${pct} attempt \${attempt}: \${out.trim().split('\\n').pop()}\`);

      // ── DEAD POOL: exit code 2 = no routes at any slippage, pool is rugged ──
      if (result.status === 2) {
        log(\`💀 DEAD POOL: \${posName} (\${ca}) — no routes found, pool rugged. Removing from positions.\`);
        if (positions[ca]) {
          logTrade('SELL', posName || ca.slice(0, 8), ca, 0, 0, null, 'Dead pool — rugged, unsellable');
          delete positions[ca];
          savePositions();
        }
        try { fs.unlinkSync(BASE_DIR + '/SELL_FAILED_URGENT.txt'); } catch {}
        return true;
      }
      // ────────────────────────────────────────────────────────────────────────

      if (out.includes('CONFIRMED')) {
        const solMatch = out.match(/sold for ~([\\d.]+) SOL/);
        const txMatch = out.match(/TX: https:\\/\\/solscan\\.io\\/tx\\/(\\S+)/);
        const solReceived = solMatch ? parseFloat(solMatch[1]) : null;
        const txSig = txMatch ? txMatch[1] : null;
        const pnlPct = entryMC && currentMC ? ((currentMC - entryMC) / entryMC * 100) : null;
        logTrade('SELL', posName || ca.slice(0, 8), ca, solReceived, solReceived,
          txSig, \`Sold \${pct}\${pnlPct !== null ? ' | PnL: ' + (pnlPct > 0 ? '+' : '') + pnlPct.toFixed(1) + '%' : ''}\`);
        return true;
      }
      if (out.includes('No tokens to sell')) { log(\`ℹ️ \${posName}: no tokens (already sold)\`); return true; }
    } catch (e) { log(\`SELL failed attempt \${attempt}: \${e.message?.slice(0, 100)}\`); }
    if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
  }
  log(\`🚨 SELL FAILED ALL 3 ATTEMPTS on \${posName} — MANUAL ACTION NEEDED\`);
  try { fs.writeFileSync(BASE_DIR + '/SELL_FAILED_URGENT.txt', \`SELL FAILED: \${posName} (\${ca}) at \${new Date().toISOString()}\\nManual: cd \${WORKSPACE} && node sell.mjs \${ca} 100%\\n\`); } catch {}
  try { execSync(\`openclaw system event --text "🚨 SELL FAILED: \${posName} — manual action needed!" --mode now\`, { timeout: 5000 }); } catch {}
  return false;
}`;

if (!code.includes('// ─── SELL')) {
  console.error('❌ Could not find sell function — has the file changed?');
  process.exit(1);
}

code = code.replace(oldSell, newSell);
fs.writeFileSync(file, code);
console.log('✅ Patched! Dead pool detection is now live in gizmo.mjs');
