import fs from 'fs';

const file = process.env.HOME + '/.openclaw/workspace/SOLGizmo/gizmo.mjs';
fs.copyFileSync(file, file + '.bak3');

let code = fs.readFileSync(file, 'utf8');

// Find the unique line after spawnSync and inject dead pool check after it
const target = `      log(\`SELL \${pct} attempt \${attempt}: \${out.trim().split('\\n').pop()}\`);`;
const injection = `
      // ── DEAD POOL: exit code 2 = rugged, stop retrying ──
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

if (code.includes('DEAD POOL: exit code 2')) {
  console.log('✅ Already patched — nothing to do!');
  process.exit(0);
}

if (!code.includes(target)) {
  console.error('❌ Could not find injection point. Paste your gizmo.mjs to Claude for help.');
  process.exit(1);
}

code = code.replace(target, target + injection);
fs.writeFileSync(file, code);
console.log('✅ Backed up to gizmo.mjs.bak3');
console.log('✅ Patched! POV will now be dropped after first dead pool detection.');
