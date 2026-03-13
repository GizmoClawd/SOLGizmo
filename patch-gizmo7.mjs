import fs from 'fs';

const file = process.env.HOME + '/.openclaw/workspace/SOLGizmo/gizmo.mjs';
fs.copyFileSync(file, file + '.bak7');

let code = fs.readFileSync(file, 'utf8');

const oldCheck = `      // ── DEAD POOL: exit code 2 = no routes at any slippage, pool is rugged ──
      if (result.status === 2) {`;

const newCheck = `      // ── DEAD POOL: exit code 2 OR text match (status can be null on some systems) ──
      if (result.status === 2 || out.includes('DEAD POOL')) {`;

if (!code.includes(oldCheck)) {
  console.error('❌ Could not find dead pool check line');
  process.exit(1);
}

code = code.replace(oldCheck, newCheck);
fs.writeFileSync(file, code);
console.log('✅ Backed up to gizmo.mjs.bak7');
console.log('✅ Dead pool now triggers on exit code 2 OR output text — bulletproof.');
