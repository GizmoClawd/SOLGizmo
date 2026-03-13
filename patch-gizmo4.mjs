import fs from 'fs';

const file = process.env.HOME + '/.openclaw/workspace/SOLGizmo/gizmo.mjs';
fs.copyFileSync(file, file + '.bak4');

let code = fs.readFileSync(file, 'utf8');

const oldBlock = `      // ── DEAD POOL: exit code 2 = no routes at any slippage, pool is rugged ──
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
      // ────────────────────────────────────────────────────────────────────────`;

const newBlock = `      // ── DEAD POOL: exit code 2 = no routes at any slippage, pool is rugged ──
      if (result.status === 2) {
        log(\`💀 DEAD POOL: \${posName} (\${ca}) — force removing from positions.\`);
        // Match by CA key OR by name to handle any key format
        for (const key of Object.keys(positions)) {
          if (key === ca || (positions[key] && positions[key].name === posName)) {
            logTrade('SELL', posName || ca.slice(0, 8), ca, 0, 0, null, 'Dead pool — rugged, unsellable');
            delete positions[key];
          }
        }
        savePositions();
        try { fs.unlinkSync(BASE_DIR + '/SELL_FAILED_URGENT.txt'); } catch {}
        return true;
      }
      // ────────────────────────────────────────────────────────────────────────`;

if (!code.includes(oldBlock)) {
  // Try to show what's actually around line 275 to debug
  const lines = code.split('\n').slice(273, 290);
  console.error('❌ String mismatch. Lines 274-290 of your file:');
  lines.forEach((l, i) => console.error(`${274+i}: ${l}`));
  process.exit(1);
}

code = code.replace(oldBlock, newBlock);
fs.writeFileSync(file, code);
console.log('✅ Backed up to gizmo.mjs.bak4');
console.log('✅ POV dead pool now force-deletes by name AND ca — loop will stop.');
