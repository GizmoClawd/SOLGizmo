import fs from 'fs';

const file = process.env.HOME + '/.openclaw/workspace/SOLGizmo/gizmo.mjs';
fs.copyFileSync(file, file + '.bak4');

let code = fs.readFileSync(file, 'utf8');

// Replace the existing dead pool block with a better one that force-deletes
const oldBlock = `      // ── DEAD POOL: exit code 2 = rugged, stop retrying ──
      if (result.status === 2) {
        log(\`💀 DEAD POOL: \${posName} (\${ca}) — rugged, removing from positions.\`);
        if (positions[ca]) {
          logTrade('SELL', posName || ca.slice(0, 8), ca, 0, 0, null, 'Dead pool — rugged, unsellable');
          delete positions[ca];
          savePositions();
        }
        try { fs.unlinkSync(BASE_DIR + '/SELL_FAILED_URGENT.txt'); } catch {}
        return true;
      }
      // ───────────────────────────────────────────────────`;

const newBlock = `      // ── DEAD POOL: exit code 2 = rugged, stop retrying ──
      if (result.status === 2) {
        log(\`💀 DEAD POOL: \${posName} (\${ca}) — rugged. Force-removing from positions.\`);
        // Force delete by both ca key and any partial match (handles key mismatch)
        let deleted = false;
        for (const key of Object.keys(positions)) {
          if (key === ca || positions[key].name === posName) {
            logTrade('SELL', posName || ca.slice(0, 8), ca, 0, 0, null, 'Dead pool — rugged, unsellable');
            delete positions[key];
            deleted = true;
          }
        }
        if (deleted) savePositions();
        else log(\`⚠️ DEAD POOL: \${posName} not found in positions — may already be gone\`);
        try { fs.unlinkSync(BASE_DIR + '/SELL_FAILED_URGENT.txt'); } catch {}
        return true;
      }
      // ───────────────────────────────────────────────────`;

if (!code.includes(oldBlock)) {
  console.error('❌ Could not find existing dead pool block to replace.');
  process.exit(1);
}

code = code.replace(oldBlock, newBlock);
fs.writeFileSync(file, code);
console.log('✅ Backed up to gizmo.mjs.bak4');
console.log('✅ Dead pool now force-deletes position by name AND ca key — POV loop fixed.');
