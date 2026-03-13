import fs from 'fs';

const file = process.env.HOME + '/.openclaw/workspace/SOLGizmo/gizmo.mjs';
fs.copyFileSync(file, file + '.bak6');

let code = fs.readFileSync(file, 'utf8');

// Find and replace the dead pool block — fix positions → POSITIONS (array)
const oldBlock = `      // ── DEAD POOL: exit code 2 = no routes at any slippage, pool is rugged ──
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

const newBlock = `      // ── DEAD POOL: exit code 2 = no routes at any slippage, pool is rugged ──
      if (result.status === 2) {
        log(\`💀 DEAD POOL: \${posName} (\${ca}) — force removing from positions.\`);
        // POSITIONS is an array — find and splice out by ca or name
        const idx = POSITIONS.findIndex(p => p.ca === ca || p.name === posName);
        if (idx !== -1) {
          logTrade('SELL', posName || ca.slice(0, 8), ca, 0, 0, null, 'Dead pool — rugged, unsellable');
          POSITIONS.splice(idx, 1);
          savePositions();
          log(\`🗑️ DEAD POOL: \${posName} removed from POSITIONS. No more retries.\`);
        } else {
          log(\`⚠️ DEAD POOL: \${posName} not found in POSITIONS — may already be gone\`);
        }
        try { fs.unlinkSync(BASE_DIR + '/SELL_FAILED_URGENT.txt'); } catch {}
        return true;
      }
      // ────────────────────────────────────────────────────────────────────────`;

if (!code.includes(oldBlock)) {
  // Show what's actually in the dead pool block for debugging
  const start = code.indexOf('DEAD POOL: exit code 2');
  if (start === -1) { console.error('❌ No dead pool block found at all'); process.exit(1); }
  console.error('❌ Dead pool block found but text mismatch. Current block:');
  console.error(code.slice(start - 6, start + 600));
  process.exit(1);
}

code = code.replace(oldBlock, newBlock);
fs.writeFileSync(file, code);
console.log('✅ Backed up to gizmo.mjs.bak6');
console.log('✅ Fixed! Dead pool now correctly splices from POSITIONS array.');
console.log('   POV will be removed and retries will stop.');
